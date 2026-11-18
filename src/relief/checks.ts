import type { ReliefBase, ReliefSettings, WarningItem } from '../types';
import type { HeightmapData } from './heightmap';

/**
 * True when the subject's edges stand out further than its middle. A solid subject seen from the
 * front always falls away toward its outline, so this nearly always means the depth came out
 * inside out. `height` is 0 at the wall and 1 at the closest point; `inside` marks the subject.
 * The picture's own border does not count as outline: a subject that runs off the frame has no
 * edge there to judge by.
 */
export function readsInsideOut(height: ArrayLike<number>, inside: ArrayLike<number>, cols: number, rows: number): boolean {
  const n = cols * rows;
  const FAR = 1 << 20;
  const dist = new Int32Array(n);
  let outside = 0;
  for (let i = 0; i < n; i++) { if (inside[i]) dist[i] = FAR; else outside++; }
  if (!outside || outside === n) return false;
  // Steps from the nearest cell outside the subject: two sweeps of a city-block distance.
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!dist[i]) continue;
    if (x > 0 && dist[i - 1] + 1 < dist[i]) dist[i] = dist[i - 1] + 1;
    if (y > 0 && dist[i - cols] + 1 < dist[i]) dist[i] = dist[i - cols] + 1;
  }
  let deepest = 0;
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (!dist[i]) continue;
    if (x < cols - 1 && dist[i + 1] + 1 < dist[i]) dist[i] = dist[i + 1] + 1;
    if (y < rows - 1 && dist[i + cols] + 1 < dist[i]) dist[i] = dist[i + cols] + 1;
    if (dist[i] < FAR && dist[i] > deepest) deepest = dist[i];
  }
  if (deepest < 8) return false;   // too slight a shape to have a middle
  const rimTo = Math.max(2, Math.round(deepest * 0.15)), coreFrom = Math.round(deepest * 0.6);
  const rim: number[] = [], core: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dist[i];
    if (!d || d >= FAR) continue;
    if (d <= rimTo) rim.push(height[i]); else if (d >= coreFrom) core.push(height[i]);
  }
  if (rim.length < 30 || core.length < 30) return false;
  const median = (v: number[]) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };
  return median(rim) - median(core) > 0.15;
}

/** What to check about the depth a photo build was cut from, for the list on the Slices step. */
export function reliefWarnings(base: ReliefBase, settings: ReliefSettings, heightmap: HeightmapData): WarningItem[] {
  if (base.source !== 'depth' || settings.source !== 'depth') {
    return [{
      id: 'relief-brightness', severity: 'warning',
      message: 'The depth here is the picture\'s brightness, not an estimate of its shape: light areas stand out and dark areas sink, which only suits a depth-map image. On the Design step, estimate depth, then regenerate.'
    }];
  }
  if (heightmap.mask && readsInsideOut(heightmap.values, heightmap.mask, heightmap.width, heightmap.height)) {
    return [{
      id: 'relief-inside-out', severity: 'warning',
      message: 'The edges stand out further than the middle, which usually means the depth came out inside out. If that is not what you want, flip the depth on the Design step (tap the picture), then regenerate.'
    }];
  }
  return [];
}
