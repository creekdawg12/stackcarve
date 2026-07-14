import type { Point2, Polyline, ReliefSettings } from '../types';
import { area, simplifyRdp } from '../geometry/polygon';

export interface HeightmapData {
  width: number;
  height: number;
  values: Float32Array<ArrayBufferLike>;
  previewUrl: string;
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

export async function buildHeightmap(file: File, settings: ReliefSettings, maxDimension = 512): Promise<HeightmapData> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  let values: Float32Array<ArrayBufferLike> = new Float32Array(width * height);
  const span = Math.max(1e-6, settings.whitePoint - settings.blackPoint);
  for (let i = 0; i < values.length; i++) {
    const j = i * 4;
    let v = (0.2126 * data.data[j] + 0.7152 * data.data[j + 1] + 0.0722 * data.data[j + 2]) / 255;
    v = Math.max(0, Math.min(1, (v - settings.blackPoint) / span));
    v = Math.pow(v, Math.max(0.05, settings.gamma));
    if (settings.invert) v = 1 - v;
    values[i] = v;
  }
  values = blur(values, width, height, settings.blurPx);
  for (let i = 0; i < values.length; i++) {
    const c = Math.round(values[i] * 255);
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = c;
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return { width, height, values, previewUrl: canvas.toDataURL('image/png') };
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
