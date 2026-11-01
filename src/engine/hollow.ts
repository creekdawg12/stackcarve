import type { Part2D, SliceLayer } from '../types';
import { area } from '../geometry/polygon';
import { differencePolygons, intersectMany, intersectPolygons, offsetPolygons } from '../geometry/clipper';

function bestNeighbor(part: Part2D, layer?: SliceLayer): Part2D | undefined {
  if (!layer) return undefined;
  let best: Part2D | undefined;
  let bestArea = 0;
  for (const candidate of layer.parts) {
    if (candidate.role === 'backer') continue;
    const overlap = intersectPolygons([part.outer], [candidate.outer]).reduce((s, p) => s + area(p), 0);
    if (overlap > bestArea) { bestArea = overlap; best = candidate; }
  }
  return best;
}

/**
 * Remove material that no one will ever see: the region inside the wall inset that both
 * neighbouring layers also cover (less an overlap margin for glue). Anything a part marks as
 * keepSolid (the slab back zone) stays in. Cap layers stay solid.
 */
export function applyHollowing(layers: SliceLayer[], options: {
  enabled: boolean;
  wall: number;
  overlap: number;
  bottomCaps: number;
  topCaps: number;
  reliefMode: boolean;
  reliefBaseSolid: boolean;
  /** Voids narrower than this are not worth a cut and are left solid. */
  minFeature?: number;
}) {
  const minVoid = Math.max(options.minFeature ?? 0, 0);
  for (let i = 0; i < layers.length; i++) {
    const cap = i < options.bottomCaps || i >= layers.length - options.topCaps || (options.reliefMode && options.reliefBaseSolid && i === 0);
    for (const part of layers[i].parts) {
      part.hollowCuts = [];
      if (!options.enabled || cap || part.role === 'backer') continue;
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
      let continuous = intersectMany(groups);
      if (part.keepSolid?.length && continuous.length) {
        continuous = differencePolygons(continuous, part.keepSolid.flatMap(k => offsetPolygons([k], options.overlap / 2)));
      }
      continuous = continuous.filter(p => area(p) > options.wall * options.wall && (!minVoid || offsetPolygons([p], -minVoid / 2).length > 0));
      if (!continuous.length) {
        part.warnings.push('Hollowing skipped because vertical overlap would be lost.');
        continue;
      }
      part.hollowCuts = continuous;
    }
  }
}
