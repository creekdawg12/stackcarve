import * as THREE from 'three';
import type { Axis } from '../types';

/**
 * The subject seen from the front, on a square grid: where it is and how far each point sits
 * behind its closest point. Photos, 3D models and the built-in sample all reduce to this, so the
 * planner estimates and previews every source the same way.
 *
 * Depth is stored as "behind": distance behind the front-most point.
 *   photo, sample: in fractions of the relief depth (0 = closest, 1 = at the wall)
 *   mesh:          in grid cells (multiply by the cell size in inches and the depth compression)
 */
export interface FrontField {
  kind: 'photo' | 'mesh' | 'sample';
  cols: number;
  rows: number;
  /** Front surface, row 0 at the top. Meaningful only where inside is set. */
  behind: Float32Array;
  /** Mesh only: the back surface, for models whose back is in front of the wall plane. */
  behindBack: Float32Array | null;
  inside: Uint8Array;
  /** Inclusive cell bounds of the subject. */
  box: { x0: number; x1: number; y0: number; y1: number };
  /** Extent of the subject in cells; fractional for meshes, whose bounding box rarely lands on a cell edge. */
  span: { width: number; height: number };
  /** Largest behind value inside the subject (mesh: model depth in cells). */
  maxBehind: number;
  /** Mesh only: enclosed volume in cubic cells, 0 when the mesh is open or inside out. */
  volume: number;
}

function boxOf(inside: Uint8Array, cols: number, rows: number) {
  let x0 = cols, x1 = -1, y0 = rows, y1 = -1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!inside[y * cols + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { x0: 0, x1: cols - 1, y0: 0, y1: rows - 1 };
  return { x0, x1, y0, y1 };
}

/** Field from a composed photo heightmap (0 to 1, background below the threshold). */
export function fieldFromHeightmap(map: { values: ArrayLike<number>; width: number; height: number }, threshold: number, maxCells = 256): FrontField {
  const stride = Math.max(1, Math.ceil(Math.max(map.width, map.height) / maxCells));
  const cols = Math.ceil(map.width / stride), rows = Math.ceil(map.height / stride);
  const behind = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  const span = Math.max(1e-6, 1 - threshold);
  let maxBehind = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    // The closest point in the block wins, as it does when a slab is cut from a band of pixels.
    let best = -1;
    const yEnd = Math.min(map.height, (cy + 1) * stride), xEnd = Math.min(map.width, (cx + 1) * stride);
    for (let y = cy * stride; y < yEnd; y++) for (let x = cx * stride; x < xEnd; x++) {
      const v = map.values[y * map.width + x];
      if (v > best) best = v;
    }
    const i = cy * cols + cx;
    if (best >= threshold) {
      inside[i] = 1;
      behind[i] = 1 - Math.max(0, Math.min(1, (best - threshold) / span));
      if (behind[i] > maxBehind) maxBehind = behind[i];
    } else behind[i] = 1;
  }
  const box = boxOf(inside, cols, rows);
  // Size the subject by its real pixel extent, not by whole coarse cells.
  let px0 = map.width, px1 = -1, py0 = map.height, py1 = -1;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.values[y * map.width + x] < threshold) continue;
    if (x < px0) px0 = x;
    if (x > px1) px1 = x;
    if (y < py0) py0 = y;
    if (y > py1) py1 = y;
  }
  const spanCells = px1 >= px0
    ? { width: (px1 - px0 + 1) / stride, height: (py1 - py0 + 1) / stride }
    : { width: cols, height: rows };
  return { kind: 'photo', cols, rows, behind, behindBack: null, inside, box, span: spanCells, maxBehind, volume: 0 };
}

/** How a model is looked at: wall art from in front (+Z), statues from the side with the slice axis up. */
export type FrontView = 'wall' | Axis;

/**
 * Rasterise a mesh into a front field. Every triangle is scan-converted onto the grid, keeping
 * the nearest and farthest surface per cell, so slab profiles and terrace outlines can be
 * estimated without slicing the model.
 */
export function fieldFromMesh(geometry: THREE.BufferGeometry, rotationDeg: { x: number; y: number; z: number }, view: FrontView = 'wall', maxCells = 200): FrontField | null {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return null;
  const index = geometry.index;
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(rotationDeg.x), THREE.MathUtils.degToRad(rotationDeg.y), THREE.MathUtils.degToRad(rotationDeg.z), 'XYZ')).elements;
  const n = pos.count;
  // u = to the viewer's right, v = up, w = toward the viewer.
  const U = new Float32Array(n), V = new Float32Array(n), W = new Float32Array(n);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, wMin = Infinity, wMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const x = m[0] * px + m[4] * py + m[8] * pz;
    const y = m[1] * px + m[5] * py + m[9] * pz;
    const z = m[2] * px + m[6] * py + m[10] * pz;
    let u: number, v: number, w: number;
    if (view === 'Z') { u = x; v = z; w = -y; }
    else if (view === 'X') { u = y; v = x; w = z; }
    else { u = x; v = y; w = z; }
    U[i] = u; V[i] = v; W[i] = w;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
    if (w < wMin) wMin = w;
    if (w > wMax) wMax = w;
  }
  const uExt = uMax - uMin, vExt = vMax - vMin;
  if (!(uExt > 0) || !(vExt > 0)) return null;
  const cell = Math.max(uExt, vExt) / maxCells;
  const cols = Math.max(1, Math.ceil(uExt / cell)), rows = Math.max(1, Math.ceil(vExt / cell));
  const front = new Float32Array(cols * rows).fill(-Infinity);
  const back = new Float32Array(cols * rows).fill(Infinity);
  const triangles = index ? index.count / 3 : n / 3;
  let volume6 = 0;
  for (let t = 0; t < triangles; t++) {
    const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const ax = (U[a] - uMin) / cell, ay = (vMax - V[a]) / cell, az = W[a];
    const bx = (U[b] - uMin) / cell, by = (vMax - V[b]) / cell, bz = W[b];
    const cx = (U[c] - uMin) / cell, cy = (vMax - V[c]) / cell, cz = W[c];
    // Signed volume of the tetrahedron to the origin; sums to the enclosed volume for a closed mesh.
    volume6 += U[a] * (V[b] * W[c] - W[b] * V[c]) - V[a] * (U[b] * W[c] - W[b] * U[c]) + W[a] * (U[b] * V[c] - V[b] * U[c]);
    const iMin = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), iMax = Math.min(cols - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    const jMin = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), jMax = Math.min(rows - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    if (iMin > iMax || jMin > jMax) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = jMin; j <= jMax; j++) {
      const qy = j + 0.5;
      for (let i = iMin; i <= iMax; i++) {
        const qx = i + 0.5;
        const l0 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / det;
        const l1 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const w = l0 * az + l1 * bz + l2 * cz;
        const k = j * cols + i;
        if (w > front[k]) front[k] = w;
        if (w < back[k]) back[k] = w;
      }
    }
  }
  const behind = new Float32Array(cols * rows);
  const behindBack = new Float32Array(cols * rows);
  const inside = new Uint8Array(cols * rows);
  for (let k = 0; k < front.length; k++) {
    if (front[k] === -Infinity) { behind[k] = (wMax - wMin) / cell; behindBack[k] = behind[k]; continue; }
    inside[k] = 1;
    behind[k] = (wMax - front[k]) / cell;
    behindBack[k] = (wMax - back[k]) / cell;
  }
  // A mesh pointing inside out gives a negative volume; an open one gives nonsense. Either way, do not trust it.
  const boxVolume = uExt * vExt * (wMax - wMin);
  const volume = Math.abs(volume6) / 6;
  const trusted = volume > boxVolume * 0.02 && volume < boxVolume * 1.001;
  return {
    kind: 'mesh', cols, rows, behind, behindBack, inside, box: boxOf(inside, cols, rows),
    span: { width: uExt / cell, height: vExt / cell }, maxBehind: (wMax - wMin) / cell,
    volume: trusted ? volume / (cell * cell * cell) : 0
  };
}

let sample: FrontField | null = null;

/**
 * A stand-in subject for planning before anything is loaded: a mask-like face with a brow,
 * nose, cheeks and chin, so the preview and the estimates behave like a real portrait.
 */
export function sampleField(): FrontField {
  if (sample) return sample;
  const cols = 198, rows = 240;
  const behind = new Float32Array(cols * rows).fill(1);
  const inside = new Uint8Array(cols * rows);
  const bump = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
  let maxBehind = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    // x: -1 at the left edge to 1 at the right; y: -1 at the top to 1 at the bottom.
    const x = ((i + 0.5) / cols) * 2 - 1, y = ((j + 0.5) / rows) * 2 - 1;
    // Egg-shaped outline: narrower toward the chin.
    const taper = 1 - 0.22 * Math.max(0, y);
    const r = Math.hypot(x / (0.9 * taper), (y + 0.02) / 0.94);
    if (r >= 1) continue;
    let h = 0.12 + 0.5 * Math.pow(1 - r * r, 0.62);                 // skull dome
    h += 0.34 * bump(x, y, 0, 0.1, 0.13, 0.3);                       // nose ridge
    h += 0.12 * bump(x, y, 0, 0.3, 0.2, 0.09);                       // nose tip and nostrils
    h += 0.13 * (bump(x, y, -0.38, -0.26, 0.3, 0.07) + bump(x, y, 0.38, -0.26, 0.3, 0.07)); // brow
    h -= 0.14 * (bump(x, y, -0.36, -0.1, 0.19, 0.1) + bump(x, y, 0.36, -0.1, 0.19, 0.1));   // eye sockets
    h += 0.1 * (bump(x, y, -0.46, 0.24, 0.24, 0.2) + bump(x, y, 0.46, 0.24, 0.24, 0.2));    // cheeks
    h += 0.13 * bump(x, y, 0, 0.52, 0.3, 0.08);                      // lips
    h += 0.1 * bump(x, y, 0, 0.78, 0.26, 0.12);                      // chin
    const k = j * cols + i;
    inside[k] = 1;
    behind[k] = 1 - Math.max(0.02, Math.min(1, h));
    if (behind[k] > maxBehind) maxBehind = behind[k];
  }
  const box = boxOf(inside, cols, rows);
  sample = { kind: 'sample', cols, rows, behind, behindBack: null, inside, box, span: { width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 }, maxBehind, volume: 0 };
  return sample;
}
