import type { Part2D, SliceLayer } from '../types';
import { area } from '../geometry/polygon';
import { intersectMany, intersectPolygons, offsetPolygons } from '../geometry/clipper';

function bestNeighbor(part: Part2D, layer?: SliceLayer): Part2D | undefined {
  if (!layer) return undefined;
  let best: Part2D | undefined;
  let bestArea = 0;
  for (const candidate of layer.parts) {
    const overlap = intersectPolygons([part.outer], [candidate.outer]).reduce((s, p) => s + area(p), 0);
    if (overlap > bestArea) { bestArea = overlap; best = candidate; }
  }
  return best;
}

export function applyHollowing(layers: SliceLayer[], options: {
  enabled: boolean;
  wall: number;
  overlap: number;
  bottomCaps: number;
  topCaps: number;
  reliefMode: boolean;
  reliefBaseSolid: boolean;
}) {
  for (let i = 0; i < layers.length; i++) {
    const cap = i < options.bottomCaps || i >= layers.length - options.topCaps || (options.reliefMode && options.reliefBaseSolid && i === 0);
    for (const part of layers[i].parts) {
      part.hollowCuts = [];
      if (!options.enabled || cap) continue;
      const inset = offsetPolygons([part.outer], -options.wall);
      if (!inset.length) {
        part.warnings.push('Hollowing skipped because the wall inset collapsed.');
        continue;
      }
      const groups = [inset];
      const prev = bestNeighbor(part, layers[i - 1]);
      const next = bestNeighbor(part, layers[i + 1]);
      if (prev) groups.push(offsetPolygons([prev.outer], -options.overlap));
      if (next) groups.push(offsetPolygons([next.outer], -options.overlap));
      const continuous = intersectMany(groups).filter(p => area(p) > options.wall * options.wall);
      if (!continuous.length) {
        part.warnings.push('Hollowing skipped because vertical overlap would be lost.');
        continue;
      }
      part.hollowCuts = continuous;
    }
  }
}
