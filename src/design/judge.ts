import type { ProjectSettings } from '../types';
import { composeHeightmap, suggestFloor } from '../relief/heightmap';
import { fieldFromHeightmap, type FrontField } from '../plan/field';
import { estimatePlan, type Plan } from '../plan/plan';
import { scoreField, type Scores } from './score';
import type { Picture } from './types';

export interface Judgement {
  /** The picture as the slicer would see it at this brief. */
  field: FrontField;
  plan: Plan;
  scores: Scores;
}

/** The photo settings a picture is judged with: the project's curve, and a wall plane fitted to this picture. */
export function reliefFor(picture: Picture, settings: ProjectSettings): ProjectSettings['relief'] {
  const base = { ...settings.relief, source: 'depth' as const, depthFloor: 0 };
  if (!picture.depth) return base;
  return { ...base, depthFloor: suggestFloor(picture.depth, picture.mask, base) };
}

/** Judge a field that is already composed (the picture in use shares the plan's own field). */
export function judgeField(settings: ProjectSettings, field: FrontField): Judgement {
  return { field, plan: estimatePlan(settings, field), scores: scoreField(settings, field) };
}

const cache = new WeakMap<Picture, { settings: ProjectSettings; result: Judgement }>();

/**
 * How one picture carves at the current brief. Null until the picture has depth. Results are kept
 * per picture and reused until the brief changes, so a grid of tiles costs one pass each.
 */
export function judgePicture(picture: Picture, settings: ProjectSettings): Judgement | null {
  if (!picture.depth) return null;
  const hit = cache.get(picture);
  if (hit && hit.settings === settings) return hit.result;
  const relief = reliefFor(picture, settings);
  const composed = composeHeightmap(picture.depth, { settings: relief, mask: picture.mask, preview: false });
  const field = fieldFromHeightmap(composed, relief.backgroundThreshold);
  // Scored as a photo build whatever the project is set to right now.
  const result = judgeField({ ...settings, inputMode: 'relief', relief }, field);
  cache.set(picture, { settings, result });
  return result;
}

/** The picture that carves best among those judged, or null when none has been. */
export function topPick(pictures: Picture[], settings: ProjectSettings): Picture | null {
  let best: Picture | null = null, bestRank = -Infinity;
  for (const p of pictures) {
    const j = judgePicture(p, settings);
    if (j && j.scores.rank > bestRank) { best = p; bestRank = j.scores.rank; }
  }
  return best;
}
