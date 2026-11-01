import type { DowelHole, Part2D, Point2, Polyline, SliceLayer, WarningItem } from '../types';
import { area, bounds, centroid, circlePolyline, pointInPolygon } from '../geometry/polygon';
import { differencePolygons, intersectPolygons, offsetPolygons } from '../geometry/clipper';

function allVoids(part: Part2D) { return [...part.structuralHoles, ...part.hollowCuts]; }

function safeZone(a: Part2D, b: Part2D, clearance: number, cover?: Polyline[]) {
  let zone = intersectPolygons(offsetPolygons([a.outer], -clearance), offsetPolygons([b.outer], -clearance));
  if (cover) zone = intersectPolygons(zone, cover);
  const expandedVoids = [...allVoids(a), ...allVoids(b)].flatMap(p => offsetPolygons([p], clearance));
  if (expandedVoids.length) zone = differencePolygons(zone, expandedVoids);
  return zone;
}

function bossZone(a: Part2D, b: Part2D, clearance: number, cover?: Polyline[]) {
  let zone = intersectPolygons(offsetPolygons([a.outer], -clearance), offsetPolygons([b.outer], -clearance));
  if (cover) zone = intersectPolygons(zone, cover);
  const structural = [...a.structuralHoles, ...b.structuralHoles].flatMap(p => offsetPolygons([p], clearance));
  if (structural.length) zone = differencePolygons(zone, structural);
  return zone;
}

function candidates(polys: Point2[][], spacing: number): Point2[] {
  const out: Point2[] = [];
  for (const poly of polys) {
    const b = bounds(poly);
    out.push(centroid(poly));
    // Small zones get a finer grid so two spread-out holes can still be found.
    const s = Math.max(0.05, Math.min(spacing, Math.max(b.width, b.height) / 6));
    for (let y = b.minY; y <= b.maxY + 1e-9; y += s) for (let x = b.minX; x <= b.maxX + 1e-9; x += s) {
      const p = { x, y };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

function uniqueHoles(part: Part2D, p: Point2, tolerance = 0.02) {
  return !part.dowels.some(h => Math.hypot(h.x - p.x, h.y - p.y) < tolerance);
}

function chooseSpread(points: Point2[], existing: Point2[], count: number): Point2[] {
  const selected = existing.slice();
  const pool = points.slice();
  while (selected.length < count && pool.length) {
    let bestIndex = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const score = selected.length
        ? Math.min(...selected.map(q => Math.hypot(p.x - q.x, p.y - q.y)))
        : Math.hypot(p.x, p.y);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    selected.push(pool.splice(bestIndex, 1)[0]);
  }
  return selected.slice(0, count);
}

function bestMatch(part: Part2D, next: SliceLayer): Part2D | undefined {
  let best: Part2D | undefined, score = 0;
  for (const p of next.parts) {
    if (p.role === 'backer') continue;
    const s = intersectPolygons([part.outer], [p.outer]).reduce((n, q) => n + area(q), 0);
    if (s > score) { score = s; best = p; }
  }
  return best;
}

/**
 * Place two shared dowel holes at every layer interface.
 * With hidePins on (wall art), a hole is only allowed where the layer two steps up also covers
 * it, so no through-hole ends on a visible face. Interfaces that cannot hide a pin are glued only.
 */
export function placeDowels(layers: SliceLayer[], diameter: number, edgeClearance: number, bossDiameter: number, options: { hidePins?: boolean } = {}): WarningItem[] {
  const warnings: WarningItem[] = [];
  const r = diameter / 2;
  const safeClearance = r + edgeClearance;
  let columnCounter = 1;
  const glueOnly: string[] = [];
  const orphans: { label: string; id: string; layer: number }[] = [];

  for (let i = 0; i < layers.length - 1; i++) {
    for (const lower of layers[i].parts) {
      if (lower.role === 'backer') continue;
      const upper = bestMatch(lower, layers[i + 1]);
      if (!upper) {
        orphans.push({ label: lower.label, id: lower.id, layer: i });
        continue;
      }
      let cover: Polyline[] | undefined;
      if (options.hidePins) {
        const covering = layers[i + 2] ? bestMatch(upper, layers[i + 2]) : undefined;
        if (!covering) { glueOnly.push(`${lower.label}→${upper.label}`); continue; }
        cover = offsetPolygons([covering.outer], -(r + 0.05));
        const openings = covering.structuralHoles.flatMap(h => offsetPolygons([h], r + 0.05));
        if (openings.length && cover.length) cover = differencePolygons(cover, openings);
      }
      let zone = safeZone(lower, upper, safeClearance, cover);
      const reusable = lower.dowels
        .filter(h => zone.some(p => pointInPolygon({ x: h.x, y: h.y }, p)))
        .map(h => ({ x: h.x, y: h.y, columnId: h.columnId }));
      let picked = chooseSpread(candidates(zone, Math.max(diameter * 1.5, 0.3)), reusable, 2);
      let bossAdded = false;

      if (picked.length < 2) {
        const possibleBoss = bossZone(lower, upper, safeClearance, cover);
        picked = chooseSpread(candidates(possibleBoss, Math.max(diameter * 1.5, 0.3)), reusable, 2);
        if (picked.length >= 2) {
          bossAdded = true;
          for (const p of picked) {
            const boss = circlePolyline(p, bossDiameter / 2, 0.01);
            lower.hollowCuts = differencePolygons(lower.hollowCuts, [boss]);
            upper.hollowCuts = differencePolygons(upper.hollowCuts, [boss]);
          }
          zone = safeZone(lower, upper, safeClearance, cover);
          picked = picked.filter(p => zone.some(q => pointInPolygon(p, q))).slice(0, 2);
        }
      }

      if (picked.length < 2) {
        if (options.hidePins) { glueOnly.push(`${lower.label}→${upper.label}`); continue; }
        const message = `${lower.label} → ${upper.label} cannot fit two shared dowels with the required clearance.`;
        warnings.push({ id: `dowel-fail-${lower.id}-${upper.id}`, severity: 'error', message, partId: lower.id, layerIndex: i });
        continue;
      }

      for (let k = 0; k < 2; k++) {
        const p = picked[k];
        const reused = reusable.find(h => Math.hypot(h.x - p.x, h.y - p.y) < 0.02);
        const columnId = reused?.columnId ?? `D${columnCounter++}`;
        const hole: DowelHole = { x: p.x, y: p.y, diameter, columnId, bossAdded };
        if (uniqueHoles(lower, p)) lower.dowels.push(hole);
        if (uniqueHoles(upper, p)) upper.dowels.push({ ...hole });
      }
    }
  }
  if (orphans.length) {
    const list = orphans.slice(0, 8).map(o => o.label).join(', ') + (orphans.length > 8 ? '…' : '');
    warnings.push({
      id: 'dowel-orphans',
      severity: options.hidePins ? 'info' : 'warning',
      message: options.hidePins
        ? `${orphans.length} part${orphans.length === 1 ? '' : 's'} ${orphans.length === 1 ? 'is' : 'are'} the front of a feature with nothing above (${list}); glued only, which is normal for wall art.`
        : `${orphans.length} part${orphans.length === 1 ? '' : 's'} have nothing above them to dowel into (${list}). Check they are meant to be the top of a feature.`,
      partId: orphans[0].id,
      layerIndex: orphans[0].layer
    });
  }
  if (glueOnly.length) {
    warnings.push({ id: 'pins-glue-only', severity: 'info', message: `${glueOnly.length} interface${glueOnly.length === 1 ? '' : 's'} glued without pins so no hole shows on a visible face: ${glueOnly.slice(0, 8).join(', ')}${glueOnly.length > 8 ? '…' : ''}.` });
  }
  return warnings;
}
