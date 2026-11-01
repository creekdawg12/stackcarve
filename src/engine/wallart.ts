import type { DowelHole, Part2D, Polyline, RodInfo, SliceLayer, WarningItem } from '../types';
import { area, bounds, pointInPolygon } from '../geometry/polygon';
import { differencePolygons, intersectPolygons, offsetPolygons, unionPolygons } from '../geometry/clipper';
import { regionsFromLoops, type SectionRegion } from '../mesh/slice';

/** Axis-aligned rectangle as a CCW polyline. */
export function rect(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

/**
 * Keep only the part of each section that sits in front of the back plane (drawing y >= backY).
 * The result has a straight back edge along y = backY.
 */
export function clipRegionsToBack(regions: SectionRegion[], backY: number): SectionRegion[] {
  const out: SectionRegion[] = [];
  for (const region of regions) {
    const b = bounds(region.outer);
    if (b.maxY <= backY + 1e-6) continue;
    if (b.minY >= backY - 1e-6) { out.push(region); continue; }
    const window = rect(b.minX - 1, backY, b.maxX + 1, b.maxY + 1);
    const loops = intersectPolygons([region.outer, ...region.holes], [window]);
    out.push(...regionsFromLoops(loops));
  }
  return out;
}

/** The hidden strip along the flat back edge of a slab, in drawing coordinates. */
export function backStrip(outer: Polyline, backY: number, depth: number): Polyline {
  const b = bounds(outer);
  return rect(b.minX - 1, backY - 1, b.maxX + 1, backY + depth);
}

/** Union of all slice outlines, used for the terraced base plate. */
export function silhouetteOfLayers(layers: SliceLayer[]): Polyline[] {
  const outlines = layers.flatMap(l => l.parts.filter(p => p.role !== 'backer').map(p => p.outer));
  return outlines.length ? unionPolygons(outlines) : [];
}

/**
 * Front silhouette of a slab stack as seen from the wall: each slab contributes a rectangle
 * (its x extent × its thickness band). Returned in wall coordinates (x across, y up).
 */
export function slabSilhouette(layers: SliceLayer[], thickness: number): Polyline[] {
  const rects: Polyline[] = [];
  layers.forEach((layer, i) => {
    for (const part of layer.parts) {
      if (part.role === 'backer') continue;
      const b = bounds(part.outer);
      if (b.width <= 0) continue;
      rects.push(rect(b.minX, i * thickness - 1e-4, b.maxX, (i + 1) * thickness + 1e-4));
    }
  });
  return rects.length ? unionPolygons(rects) : [];
}

function bestOverlap(part: Part2D, layer?: SliceLayer): Part2D | undefined {
  if (!layer) return undefined;
  let best: Part2D | undefined, score = 0;
  for (const candidate of layer.parts) {
    if (candidate.role === 'backer') continue;
    const s = intersectPolygons([part.outer], [candidate.outer]).reduce((n, q) => n + area(q), 0);
    if (s > score) { score = s; best = candidate; }
  }
  return best;
}

/** Region of a part that the next layer in stacking order covers, minus the part's own voids. */
export function coveredZone(part: Part2D, next: SliceLayer | undefined, margin: number): Polyline[] {
  const cover = bestOverlap(part, next);
  if (!cover) return [];
  let zone = intersectPolygons(offsetPolygons([part.outer], -margin), offsetPolygons([cover.outer], -margin));
  const openings = [...part.structuralHoles, ...part.hollowCuts, ...cover.structuralHoles].flatMap(p => offsetPolygons([p], margin));
  if (openings.length && zone.length) zone = differencePolygons(zone, openings);
  return zone;
}

export interface RodPlacement {
  rods: RodInfo[];
  warnings: WarningItem[];
}

/**
 * Choose up to two rod columns shared by every slab. A rod column is valid for a slab when the
 * hole sits inside the slab's solid back strip with clearance and the slab above covers it, so no
 * hole shows on a visible step. Slabs that fit one rod are still fully located by the rod plus the
 * flat back edge; slabs that fit none are flagged for glue-up by eye.
 */
export function placeRods(layers: SliceLayer[], options: {
  backY: number;
  zoneDepth: number;
  holeDiameter: number;
  edgeClearance: number;
  thickness: number;
}): RodPlacement {
  const warnings: WarningItem[] = [];
  const r = options.holeDiameter / 2;
  const clearance = r + options.edgeClearance;
  const yRod = options.backY + Math.max(options.zoneDepth / 2, clearance);
  if (options.zoneDepth < 2 * clearance) {
    warnings.push({ id: 'rod-zone-thin', severity: 'warning', message: `Back zone depth ${options.zoneDepth.toFixed(3)} in is thinner than the rod hole plus clearance (${(2 * clearance).toFixed(3)} in); rods sit as close to the back as clearance allows.` });
  }

  const slices = layers.map(l => l.parts.filter(p => p.role !== 'backer'));
  let minX = Infinity, maxX = -Infinity;
  for (const parts of slices) for (const p of parts) { const b = bounds(p.outer); minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); }
  if (!Number.isFinite(minX) || maxX - minX < options.holeDiameter) return { rods: [], warnings };

  // Per layer: the zone where a rod centre may sit (solid, clear of edges and voids, covered above).
  const zones: Polyline[][] = slices.map((parts, i) => {
    const out: Polyline[] = [];
    for (const part of parts) {
      const voids = [...part.structuralHoles, ...part.hollowCuts].flatMap(v => offsetPolygons([v], clearance));
      let zone = offsetPolygons([part.outer], -clearance);
      if (voids.length && zone.length) zone = differencePolygons(zone, voids);
      const above = bestOverlap(part, layers[i + 1]);
      if (above) {
        const coverOpenings = above.structuralHoles.flatMap(v => offsetPolygons([v], r + 0.05));
        let cover = offsetPolygons([above.outer], -(r + 0.05));
        if (coverOpenings.length && cover.length) cover = differencePolygons(cover, coverOpenings);
        zone = intersectPolygons(zone, cover);
      } else {
        zone = []; // top slab: a hole here would show from above
      }
      out.push(...zone);
    }
    return out;
  });

  const step = 0.05;
  const xs: number[] = [];
  for (let x = minX + clearance; x <= maxX - clearance + 1e-9; x += step) xs.push(Number(x.toFixed(4)));
  const valid = (x: number, i: number) => zones[i].some(z => pointInPolygon({ x, y: yRod }, z));
  const coverage = xs.map(x => { let n = 0; for (let i = 0; i < zones.length; i++) if (valid(x, i)) n++; return n; });
  const centerX = (minX + maxX) / 2;

  const pick = (score: (x: number, idx: number) => number) => {
    let best = -1, bestScore = -Infinity;
    xs.forEach((x, idx) => {
      const s = score(x, idx);
      if (s > bestScore + 1e-9 || (Math.abs(s - bestScore) <= 1e-9 && best >= 0 && Math.abs(x - centerX) < Math.abs(xs[best] - centerX))) { bestScore = s; best = idx; }
    });
    return bestScore > 0 ? best : -1;
  };

  const first = pick((_x, idx) => coverage[idx]);
  if (first < 0) {
    warnings.push({ id: 'rod-none', severity: 'error', message: 'No rod position fits inside the hidden back zone on any slab. Increase the back zone depth or reduce the rod hole diameter.' });
    return { rods: [], warnings };
  }
  const x1 = xs[first];
  const span = maxX - minX;
  const minSpacing = Math.max(2 * options.holeDiameter + 0.5, 0.15 * span);
  const second = pick((x, idx) => {
    if (Math.abs(x - x1) < minSpacing) return 0;
    let s = 0;
    for (let i = 0; i < zones.length; i++) if (valid(x, i)) s += valid(x1, i) ? 1 : 2;
    return s > 0 ? s + 0.5 * Math.abs(x - x1) / span : 0;
  });
  const columns = [x1, ...(second >= 0 ? [xs[second]] : [])].sort((a, b) => a - b);

  const rods: RodInfo[] = [];
  columns.forEach((x, k) => {
    const columnId = `R${k + 1}`;
    let from = -1, to = -1;
    for (let i = 0; i < slices.length; i++) {
      if (!valid(x, i)) continue;
      for (const part of slices[i]) {
        const inside = zones[i].length && pointInPolygon({ x, y: yRod }, part.outer) && !part.structuralHoles.some(h => pointInPolygon({ x, y: yRod }, h));
        if (!inside) continue;
        const hole: DowelHole = { x, y: yRod, diameter: options.holeDiameter, columnId };
        part.dowels.push(hole);
        if (from < 0) from = i;
        to = i;
      }
    }
    if (from >= 0) rods.push({ columnId, x, y: yRod, offBack: yRod - options.backY, holeDiameter: options.holeDiameter, fromLayer: from, toLayer: to, length: (to - from + 1) * options.thickness });
  });

  let two = 0, one = 0;
  const none: string[] = [];
  slices.forEach((parts, i) => {
    for (const part of parts) {
      const n = part.dowels.filter(d => d.columnId.startsWith('R')).length;
      if (n >= 2) two++; else if (n === 1) one++; else if (i < slices.length - 1) none.push(part.label);
    }
  });
  warnings.push({ id: 'rod-summary', severity: 'info', message: `Rods at x = ${columns.map(c => c.toFixed(2)).join(' and ')} in, ${(yRod - options.backY).toFixed(2)} in off the back. ${two} slabs take both rods, ${one} take one rod plus the flat back edge${none.length ? `, ${none.length} take none` : ''}.` });
  if (none.length) {
    warnings.push({ id: 'rod-glue-only', severity: 'warning', message: `Glue these slabs by eye against the back edge (no rod fits): ${none.slice(0, 12).join(', ')}${none.length > 12 ? '…' : ''}.` });
  }
  return { rods, warnings };
}
