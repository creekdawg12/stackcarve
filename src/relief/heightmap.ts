import type { Point2, Polyline, ReliefBase, ReliefSettings } from '../types';
import { area, simplifyRdp } from '../geometry/polygon';

export interface HeightmapData {
  width: number;
  height: number;
  values: Float32Array<ArrayBufferLike>;
  previewUrl: string;
  /** Cutout mask when one was used: 0 = background. */
  mask?: Uint8Array;
}

function gaussianKernel(radius: number) {
  const r = Math.max(0, Math.ceil(radius * 2));
  if (!r) return [1];
  const sigma = Math.max(0.3, radius);
  const k = Array.from({ length: r * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map(v => v / sum);
}

function blur(values: Float32Array, width: number, height: number, radius: number) {
  const kernel = gaussianKernel(radius);
  if (kernel.length === 1) return values;
  const r = (kernel.length - 1) / 2;
  const tmp = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += values[y * width + Math.max(0, Math.min(width - 1, x + k))] * kernel[k + r];
    tmp[y * width + x] = sum;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.max(0, Math.min(height - 1, y + k)) * width + x] * kernel[k + r];
    out[y * width + x] = sum;
  }
  return out;
}

/** Downscale an image file to the working grid and return it as RGBA pixels. */
export async function readPhoto(file: Blob, maxDimension = 512) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
}

/** Brightness as depth: the legacy source. Light = high. */
export async function buildLuminanceBase(file: Blob, maxDimension = 512): Promise<ReliefBase> {
  const { width, height, rgba } = await readPhoto(file, maxDimension);
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const j = i * 4;
    values[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
  }
  return { source: 'luminance', width, height, values };
}

/** Bilinear resample of a single-channel grid to a new size. */
export function resampleGrid(values: ArrayLike<number>, width: number, height: number, newWidth: number, newHeight: number): Float32Array {
  const out = new Float32Array(newWidth * newHeight);
  for (let y = 0; y < newHeight; y++) {
    const sy = newHeight > 1 ? (y / (newHeight - 1)) * (height - 1) : 0;
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < newWidth; x++) {
      const sx = newWidth > 1 ? (x / (newWidth - 1)) * (width - 1) : 0;
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const a = values[y0 * width + x0], b = values[y0 * width + x1], c = values[y1 * width + x0], d = values[y1 * width + x1];
      out[y * newWidth + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

/** Normalise raw model depth so the closest point is 1 and the farthest 0. */
export function normalizeDepth(values: Float32Array): Float32Array {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (!Number.isFinite(v)) continue; if (v < min) min = v; if (v > max) max = v; }
  const span = max - min;
  const out = new Float32Array(values.length);
  if (!Number.isFinite(span) || span <= 0) return out;
  for (let i = 0; i < values.length; i++) out[i] = Number.isFinite(values[i]) ? (values[i] - min) / span : 0;
  return out;
}

export interface ComposeOptions {
  settings: ReliefSettings;
  /** 0 = background, anything else = part of the piece. Same size as the base. */
  mask?: Uint8Array | null;
  /** Skip the preview image (tests and workers). */
  preview?: boolean;
}

/**
 * Turn a raw base and an optional cutout mask into the heightmap the slicer consumes.
 * Inside the silhouette, values are at least just above the background threshold so the
 * base plate and slabs follow the mask exactly; outside they are 0.
 */
/** Invert, levels and gamma applied to one raw value, before the wall-plane floor. */
export function curveValue(raw: number, settings: ReliefSettings) {
  const span = Math.max(1e-6, settings.whitePoint - settings.blackPoint);
  let v = settings.invert ? 1 - raw : raw;
  v = Math.max(0, Math.min(1, (v - settings.blackPoint) / span));
  return Math.pow(v, Math.max(0.05, settings.gamma));
}

/**
 * Where the wall plane should sit so the subject uses the whole relief depth: the depth of the
 * farthest few percent of pixels inside the mask (the back of the ears on a face), not the
 * background the model also measured.
 */
export function suggestFloor(base: ReliefBase, mask: Uint8Array | null, settings: ReliefSettings, percentile = 0.03) {
  const inside: number[] = [];
  for (let i = 0; i < base.values.length; i++) {
    if (mask ? mask[i] : base.values[i] >= settings.backgroundThreshold) inside.push(curveValue(base.values[i], settings));
  }
  if (inside.length < 10) return 0;
  inside.sort((a, b) => a - b);
  const v = inside[Math.min(inside.length - 1, Math.floor(inside.length * percentile))];
  return Math.max(0, Math.min(0.9, Math.round(v * 100) / 100));
}

export function composeHeightmap(base: ReliefBase, options: ComposeOptions): HeightmapData {
  const { settings } = options;
  const { width, height } = base;
  const floor = Math.max(0, Math.min(0.95, settings.depthFloor));
  let values: Float32Array<ArrayBufferLike> = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    values[i] = Math.max(0, (curveValue(base.values[i], settings) - floor) / (1 - floor));
  }
  const mask = options.mask;
  if (mask && settings.blurPx > 0) {
    // Normalised blur: background pixels carry no weight, so the subject's edge keeps its depth.
    const weight = new Float32Array(values.length);
    const weighted = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) if (mask[i]) { weight[i] = 1; weighted[i] = values[i]; }
    const num = blur(weighted, width, height, settings.blurPx);
    const den = blur(weight, width, height, settings.blurPx);
    for (let i = 0; i < values.length; i++) values[i] = den[i] > 1e-4 ? num[i] / den[i] : 0;
  } else {
    values = blur(values, width, height, settings.blurPx);
  }
  const insideMin = Math.min(0.999, settings.backgroundThreshold + 0.002);
  if (mask) {
    for (let i = 0; i < values.length; i++) values[i] = mask[i] ? Math.max(insideMin, values[i]) : 0;
  }
  let previewUrl = '';
  if (options.preview !== false && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < values.length; i++) {
      const inside = mask ? mask[i] !== 0 : values[i] >= settings.backgroundThreshold;
      const c = Math.round(values[i] * 255);
      if (inside) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c; }
      else { img.data[i * 4] = 28; img.data[i * 4 + 1] = 38; img.data[i * 4 + 2] = 52; }
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    previewUrl = canvas.toDataURL('image/png');
  }
  return { width, height, values, previewUrl, mask: mask ?? undefined };
}

/** Legacy one-shot helper: brightness base composed with the current settings and no mask. */
export async function buildHeightmap(file: File, settings: ReliefSettings, maxDimension = 512): Promise<HeightmapData> {
  const base = await buildLuminanceBase(file, maxDimension);
  return composeHeightmap(base, { settings });
}

/** Resample a mask or alpha channel (0 to 255) to the base grid and threshold it. */
export function maskFromAlpha(alpha: Uint8Array | Uint8ClampedArray, width: number, height: number, newWidth: number, newHeight: number, threshold = 128): Uint8Array {
  const resampled = resampleGrid(alpha, width, height, newWidth, newHeight);
  const out = new Uint8Array(newWidth * newHeight);
  for (let i = 0; i < out.length; i++) out[i] = resampled[i] >= threshold ? 255 : 0;
  return out;
}

/** Mask from the depth itself: everything below the threshold is background. */
export function maskFromThreshold(base: ReliefBase, threshold: number): Uint8Array {
  const out = new Uint8Array(base.values.length);
  for (let i = 0; i < out.length; i++) out[i] = base.values[i] >= threshold ? 255 : 0;
  return out;
}

type Segment = [Point2, Point2];

function stitch(segments: Segment[]): Polyline[] {
  const tol = 1e-4;
  const key = (p: Point2) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const map = new Map<string, { i: number; end: number }[]>();
  segments.forEach((s, i) => s.forEach((p, end) => map.set(key(p), [...(map.get(key(p)) ?? []), { i, end }])));
  const used = new Uint8Array(segments.length);
  const loops: Polyline[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segments[i][0], segments[i][1]];
    let current = segments[i][1];
    let guard = 0;
    while (key(current) !== key(loop[0]) && guard++ < segments.length + 4) {
      const next = (map.get(key(current)) ?? []).find(x => !used[x.i]);
      if (!next) break;
      used[next.i] = 1;
      current = segments[next.i][next.end === 0 ? 1 : 0];
      loop.push(current);
    }
    if (loop.length > 3 && key(current) === key(loop[0])) { loop.pop(); loops.push(loop); }
  }
  return loops;
}

export function marchingSquares(
  map: HeightmapData,
  threshold: number,
  finishedWidth: number,
  simplifyTolerance: number,
  minArea: number
): Polyline[] {
  const { width, height, values } = map;
  const sx = finishedWidth / (width - 1);
  const sy = sx;
  const segments: Segment[] = [];
  const v = (x: number, y: number) => values[y * width + x];
  const lerp = (a: number, b: number) => Math.abs(b - a) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (threshold - a) / (b - a)));
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);
    const code = (a >= threshold ? 1 : 0) | (b >= threshold ? 2 : 0) | (c >= threshold ? 4 : 0) | (d >= threshold ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const top = { x: (x + lerp(a, b)) * sx, y: (height - 1 - y) * sy };
    const right = { x: (x + 1) * sx, y: (height - 1 - (y + lerp(b, c))) * sy };
    const bottom = { x: (x + lerp(d, c)) * sx, y: (height - 2 - y) * sy };
    const left = { x: x * sx, y: (height - 1 - (y + lerp(a, d))) * sy };
    const add = (p: Point2, q: Point2) => segments.push([p, q]);
    switch (code) {
      case 1: case 14: add(left, top); break;
      case 2: case 13: add(top, right); break;
      case 3: case 12: add(left, right); break;
      case 4: case 11: add(right, bottom); break;
      case 5: add(left, top); add(right, bottom); break;
      case 6: case 9: add(top, bottom); break;
      case 7: case 8: add(left, bottom); break;
      case 10: add(top, right); add(left, bottom); break;
    }
  }
  return stitch(segments)
    .map(p => simplifyRdp(p, simplifyTolerance))
    .filter(p => p.length >= 3 && area(p) >= minArea)
    .sort((a, b) => area(b) - area(a));
}

/** Label 4-connected regions of a 0/255 mask. Returns labels (0 = background) and the pixel count per label. */
function labelRegions(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = next++;
    let size = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width, y = (i - x) / width;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && !labels[i - width]) { labels[i - width] = id; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && !labels[i + width]) { labels[i + width] = id; stack.push(i + width); }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Keep only the largest connected region of the mask; specks and stray background pieces go. */
export function keepLargestRegion(mask: Uint8Array, width: number, height: number): Uint8Array {
  const { labels, sizes } = labelRegions(mask, width, height);
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const out = new Uint8Array(mask.length);
  if (best === 0) return out;
  for (let i = 0; i < mask.length; i++) out[i] = labels[i] === best ? 255 : 0;
  return out;
}

/** Fill background pockets that are completely enclosed by the mask (eyes, gaps between wrinkles). */
export function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const reach = new Uint8Array(mask.length);
  const stack: number[] = [];
  const seed = (i: number) => { if (!mask[i] && !reach[i]) { reach[i] = 1; stack.push(i); } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width, y = (i - x) / width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y < height - 1) seed(i + width);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] || !reach[i] ? 255 : 0;
  return out;
}
