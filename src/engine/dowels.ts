import type { DowelHole, Part2D, Point2, SliceLayer, WarningItem } from '../types';
import { area, bounds, centroid, circlePolyline, pointInPolygon } from '../geometry/polygon';
import { differencePolygons, intersectPolygons, offsetPolygons } from '../geometry/clipper';

function allVoids(part: Part2D) { return [...part.structuralHoles, ...part.hollowCuts]; }

function safeZone(a: Part2D, b: Part2D, clearance: number) {
  let zone = intersectPolygons(offsetPolygons([a.outer], -clearance), offsetPolygons([b.outer], -clearance));
  const expandedVoids = [...allVoids(a), ...allVoids(b)].flatMap(p => offsetPolygons([p], clearance));
  if (expandedVoids.length) zone = differencePolygons(zone, expandedVoids);
  return zone;
}

function bossZone(a: Part2D, b: Part2D, clearance: number) {
  let zone = intersectPolygons(offsetPolygons([a.outer], -clearance), offsetPolygons([b.outer], -clearance));
  const structural = [...a.structuralHoles, ...b.structuralHoles].flatMap(p => offsetPolygons([p], clearance));
  if (structural.length) zone = differencePolygons(zone, structural);
  return zone;
}

function candidates(polys: Point2[][], spacing: number): Point2[] {
  const out: Point2[] = [];
  for (const poly of polys) {
    const b = bounds(poly);
    out.push(centroid(poly));
    for (let y = b.minY; y <= b.maxY; y += spacing) for (let x = b.minX; x <= b.maxX; x += spacing) {
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
    const s = intersectPolygons([part.outer], [p.outer]).reduce((n, q) => n + area(q), 0);
    if (s > score) { score = s; best = p; }
  }
  return best;
}

export function placeDowels(layers: SliceLayer[], diameter: number, edgeClearance: number, bossDiameter: number): WarningItem[] {
  const warnings: WarningItem[] = [];
  const r = diameter / 2;
  const safeClearance = r + edgeClearance;
  let columnCounter = 1;

  for (let i = 0; i < layers.length - 1; i++) {
    for (const lower of layers[i].parts) {
      const upper = bestMatch(lower, layers[i + 1]);
      if (!upper) {
        warnings.push({ id: `dowel-no-neighbor-${lower.id}`, severity: 'warning', message: `${lower.label} has no overlapping part in the next layer.`, partId: lower.id, layerIndex: i });
        continue;
      }
      let zone = safeZone(lower, upper, safeClearance);
      const reusable = lower.dowels
        .filter(h => zone.some(p => pointInPolygon({ x: h.x, y: h.y }, p)))
        .map(h => ({ x: h.x, y: h.y, columnId: h.columnId }));
      let picked = chooseSpread(candidates(zone, Math.max(diameter * 1.5, 0.3)), reusable, 2);
      let bossAdded = false;

      if (picked.length < 2) {
        const possibleBoss = bossZone(lower, upper, safeClearance);
        picked = chooseSpread(candidates(possibleBoss, Math.max(diameter * 1.5, 0.3)), reusable, 2);
        if (picked.length >= 2) {
          bossAdded = true;
          for (const p of picked) {
            const boss = circlePolyline(p, bossDiameter / 2, 0.01);
            lower.hollowCuts = differencePolygons(lower.hollowCuts, [boss]);
            upper.hollowCuts = differencePolygons(upper.hollowCuts, [boss]);
          }
          zone = safeZone(lower, upper, safeClearance);
          picked = picked.filter(p => zone.some(q => pointInPolygon(p, q))).slice(0, 2);
        }
      }

      if (picked.length < 2) {
        const message = `${lower.label} → ${upper.label} cannot fit two shared dowels with the required clearance.`;
        lower.warnings.push(message); upper.warnings.push(message);
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
  return warnings;
}
