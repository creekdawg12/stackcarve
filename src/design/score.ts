import type { ProjectSettings } from '../types';
import type { FrontField } from '../plan/field';
import { resolveField, type ResolvedField } from '../plan/plan';
import { slabStack } from '../plan/cut';
import { labelRegions } from './split';

/**
 * How well a picture will carve at the current brief, measured rather than guessed:
 *   detail  - how much of the subject's shape survives being cut into slabs or layers
 *   sturdy  - how few loose or sliver-thin pieces the cut produces
 * Each runs from 0 to 100. They judge the cut, not the picture: the same picture scores
 * differently in thinner stock or at a bigger size, which is the point.
 *
 * There is deliberately no score for "uses the depth well". Tried against the real depth model
 * it read full marks for everything, flat medallions included, because the model rounds flat
 * subjects into domes. A meter that never moves is worse than no meter; depth is left to the eye.
 */

export type Verdict = 'cut' | 'tweak' | 'rework';

export type SuggestionId = 'simplify' | 'deepen' | 'thicken' | 'whole';

export interface Suggestion {
  id: SuggestionId;
  /** Short label for the checkbox. */
  label: string;
  /** The sentence that goes to ChatGPT. */
  text: string;
}

export interface Scores {
  detail: number;
  sturdy: number;
  /** One number for ranking pictures against each other. */
  rank: number;
  verdict: Verdict;
  notes: { detail: string; sturdy: string };
  /** Changes worth asking for, the ones these checks call for first and ticked. */
  suggestions: (Suggestion & { called: boolean })[];
  /** Loose pieces and slivers the cut would make. */
  fragile: number;
  pieces: number;
  /** True when the subject runs off the top or a side of the picture. */
  cropped: boolean;
}

export const GOOD = 70;
export const FAIR = 45;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** One box-blur pass along rows then columns, zero beyond the grid. */
function boxPass(src: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    let sum = 0;
    for (let x = 0; x <= Math.min(cols - 1, radius); x++) sum += src[row + x];
    for (let x = 0; x < cols; x++) {
      tmp[row + x] = sum;
      const add = x + radius + 1, drop = x - radius;
      if (add < cols) sum += src[row + add];
      if (drop >= 0) sum -= src[row + drop];
    }
  }
  for (let x = 0; x < cols; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(rows - 1, radius); y++) sum += tmp[y * cols + x];
    for (let y = 0; y < rows; y++) {
      out[y * cols + x] = sum;
      const add = y + radius + 1, drop = y - radius;
      if (add < rows) sum += tmp[add * cols + x];
      if (drop >= 0) sum -= tmp[drop * cols + x];
    }
  }
  return out;
}

/**
 * Smooth a surface without letting the empty background pull its edges down: three box passes
 * (close to a Gaussian) over the values and over the mask, divided at the end.
 */
export function maskedBlur(values: Float32Array, inside: Uint8Array, cols: number, rows: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  let num: Float32Array = new Float32Array(values.length), den: Float32Array = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) if (inside[i]) { num[i] = values[i]; den[i] = 1; }
  for (let pass = 0; pass < 3; pass++) { num = boxPass(num, cols, rows, r); den = boxPass(den, cols, rows, r); }
  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i++) out[i] = den[i] > 1e-6 ? num[i] / den[i] : 0;
  return out;
}

/** The surface as the cut presents it: each slab's edge held across its pitch, or depth in whole layers. */
function asCut(settings: ProjectSettings, r: ResolvedField): Float32Array {
  const q = new Float32Array(r.front.length);
  if (r.mode === 'slabs') {
    const { slabs, vertical, samples } = slabStack(settings, r);
    for (const slab of slabs) for (let a = slab.hold0; a <= slab.hold1; a++) {
      const line = vertical ? a : r.rows - 1 - a;
      for (let s = 0; s < samples; s++) q[vertical ? s * r.cols + line : line * r.cols + s] = slab.profile[s];
    }
    return q;
  }
  const t = settings.materialThickness;
  const n = Math.max(1, Math.round(r.keep / t));
  for (let i = 0; i < q.length; i++) {
    if (!r.inside[i]) continue;
    q[i] = n > 1 ? Math.min(n - 1, Math.floor(r.front[i] * (n - 1) / Math.max(1e-6, r.keep) + 1e-9)) + 1 : 1;
  }
  return q;
}

/** Share of the subject's feature-scale relief that the cut reproduces, 0 to 1. */
function detailKept(settings: ProjectSettings, r: ResolvedField): number {
  const { cols, rows, inside, front } = r;
  const radius = Math.max(2, r.span.width / 8);
  const cut = asCut(settings, r);
  const smoothFront = maskedBlur(front, inside, cols, rows, radius);
  const smoothCut = maskedBlur(cut, inside, cols, rows, radius);
  let dd = 0, qq = 0, dq = 0, count = 0;
  for (let i = 0; i < front.length; i++) {
    if (!inside[i]) continue;
    const d = front[i] - smoothFront[i], q = cut[i] - smoothCut[i];
    dd += d * d; qq += q * q; dq += d * q;
    count++;
  }
  if (!count) return 0;
  // A subject with no features to speak of has nothing to lose.
  if (Math.sqrt(dd / count) < 0.012 * Math.max(1e-6, r.keep)) return 1;
  if (dd <= 0 || qq <= 0) return 0;
  const corr = dq / Math.sqrt(dd * qq);
  return clamp01(corr) ** 2;
}

/** Pieces the cut makes, and how many of them are loose bits or slivers that have to be placed by hand. */
function fragility(settings: ProjectSettings, r: ResolvedField): { pieces: number; fragile: number } {
  let pieces = 0, fragile = 0;
  if (r.mode === 'slabs') {
    const { slabs } = slabStack(settings, r);
    const shortest = Math.max(1.5, settings.minFeature * 4);
    for (const slab of slabs) {
      const runs: number[] = [];
      let run = 0;
      for (let s = 0; s <= slab.profile.length; s++) {
        if (s < slab.profile.length && slab.profile[s] > 0) run++;
        else if (run) { runs.push(run * r.cell); run = 0; }
      }
      const kept = runs.filter(len => len >= settings.minFeature);
      if (!kept.length) continue;
      const longest = Math.max(...kept);
      pieces += kept.length;
      // Every run beyond the longest is a separate piece no rod can hold; a slab too short for a rod is no better.
      fragile += kept.length - 1 + (longest < shortest ? 1 : 0);
    }
    return { pieces, fragile };
  }
  const t = settings.materialThickness;
  const n = Math.max(1, Math.round(r.keep / t));
  const minArea = Math.max(settings.minFeature * settings.minFeature, r.photo ? settings.relief.minIslandArea : 0);
  const level = new Int16Array(r.front.length).fill(-1);
  for (let i = 0; i < level.length; i++) {
    if (r.inside[i]) level[i] = n > 1 ? Math.min(n - 1, Math.floor(r.front[i] * (n - 1) / Math.max(1e-6, r.keep) + 1e-9)) : 0;
  }
  const mask = new Uint8Array(level.length);
  const cellArea = r.cell * r.cell;
  for (let k = 0; k < n; k++) {
    let any = false;
    for (let i = 0; i < mask.length; i++) { mask[i] = level[i] >= k ? 255 : 0; if (mask[i]) any = true; }
    if (!any) break;
    const { areas, boxes } = labelRegions(mask, r.cols, r.rows);
    let largest = 0;
    for (let id = 1; id < areas.length; id++) largest = Math.max(largest, areas[id]);
    for (let id = 1; id < areas.length; id++) {
      const a = areas[id] * cellArea;
      if (a < minArea) continue;
      pieces++;
      const b = boxes[id];
      const narrow = Math.min(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) * r.cell;
      // On the back layer anything apart from the main outline hangs on nothing; above it, only slivers are a worry.
      if (k === 0 ? areas[id] < largest : (a < 1 || narrow < 0.5)) fragile++;
    }
  }
  return { pieces, fragile };
}

function runsOffEdge(field: FrontField): boolean {
  const { cols, rows, inside } = field;
  let top = 0, left = 0, right = 0;
  for (let x = 0; x < cols; x++) if (inside[x]) top++;
  for (let y = 0; y < rows; y++) { if (inside[y * cols]) left++; if (inside[y * cols + cols - 1]) right++; }
  return top > cols * 0.06 || left > rows * 0.06 || right > rows * 0.06;
}

const toScore = (v: number) => Math.round(clamp01(v) * 100);

export function scoreField(settings: ProjectSettings, field: FrontField): Scores {
  const r = resolveField(settings, field);
  let any = false;
  for (let i = 0; i < r.inside.length && !any; i++) any = r.inside[i] === 1;
  if (!any) {
    const nothing = 'Nothing to cut at these settings.';
    return { detail: 0, sturdy: 0, rank: 0, verdict: 'rework', fragile: 0, pieces: 0, cropped: false, notes: { detail: nothing, sturdy: nothing }, suggestions: [] };
  }
  const slabs = r.mode === 'slabs';
  const t = settings.materialThickness;
  const pitch = t + (slabs ? Math.max(0, settings.wallArt.slabGap) : 0);

  const detail = toScore(detailKept(settings, r));
  const { pieces, fragile } = fragility(settings, r);
  const share = pieces ? fragile / pieces : 0;
  const sturdy = toScore(1 - share * 2.5);
  const cropped = runsOffEdge(field);

  const cutWord = slabs ? 'slab spacing' : 'layer thickness';
  const notes = {
    detail: detail >= 85 ? `Nearly all of the shape survives at this ${cutWord}.`
      : detail >= GOOD ? 'Most of the shape survives; the finest detail softens.'
        : detail >= FAIR ? `Fine detail is lost at this ${cutWord}. Bolder forms, thinner stock or a bigger piece would hold more.`
          : `Much of the detail is finer than the ${slabs ? 'slabs' : 'layers'} can show.`,
    sturdy: fragile === 0 ? 'No loose or sliver-thin pieces.'
      : `${fragile} of ${pieces} pieces ${fragile === 1 ? 'is' : 'are'} loose or very small and would be placed by hand.`
  };

  const across = Math.max(4, Math.floor((r.span.width * r.cell) / (2 * pitch)));
  const suggestions: Scores['suggestions'] = [
    slabs
      ? { id: 'simplify', label: 'Simplify fine detail', called: detail < GOOD, text: `Simplify the surface: merge fine wrinkles, fur and small texture into a few big, smooth forms, with no feature narrower than about one ${ordinalWord(across)} of the width` }
      : { id: 'simplify', label: 'Make features bolder', called: detail < GOOD, text: 'Make every feature bolder and deeper so it stands clearly forward of what is around it, and drop shallow surface texture' },
    { id: 'thicken', label: 'Thicken thin parts', called: sturdy < GOOD, text: 'Thicken or remove thin parts and loose bits, and close any gaps, so the whole piece is one solid shape with a simple outline' },
    { id: 'deepen', label: 'Push the depth', called: false, text: 'Push the depth: bring the nearest parts well forward and set the rest further back, like a deep high-relief carving' },
    { id: 'whole', label: 'Show the whole subject', called: cropped, text: 'Show the whole subject, centered, with clear white space on every side' }
  ];

  const worst = Math.min(detail, sturdy);
  // A subject that runs off the picture can still be cut, but it is never the finished answer.
  const verdict: Verdict = worst >= GOOD ? (cropped ? 'tweak' : 'cut') : worst >= FAIR ? 'tweak' : 'rework';
  return { detail, sturdy, rank: 0.6 * detail + 0.4 * sturdy - (cropped ? 5 : 0), verdict, notes, suggestions, fragile, pieces, cropped };
}

function ordinalWord(n: number): string {
  const words: Record<number, string> = { 4: 'quarter', 5: 'fifth', 6: 'sixth', 8: 'eighth', 10: 'tenth', 12: 'twelfth', 15: 'fifteenth', 20: 'twentieth', 25: 'twenty-fifth', 30: 'thirtieth', 40: 'fortieth', 50: 'fiftieth' };
  // Round down to a fraction people say out loud.
  const steps = [50, 40, 30, 25, 20, 15, 12, 10, 8, 6, 5, 4];
  const pick = steps.find(s => s <= n) ?? 4;
  return words[pick];
}

export const VERDICT_LABEL: Record<Verdict, string> = { cut: 'Good to cut', tweak: 'Worth a tweak', rework: 'Needs rework' };
