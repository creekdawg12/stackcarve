import * as THREE from 'three';
import type { Axis, Point2, Polyline } from '../types';
import { area, centroid, ensureCCW, ensureCW, pointInPolygon, simplifyRdp } from '../geometry/polygon';

export interface SectionRegion {
  outer: Polyline;
  holes: Polyline[];
}

function axisCoord(v: THREE.Vector3, axis: Axis) {
  return axis === 'X' ? v.x : axis === 'Y' ? v.y : v.z;
}

/**
 * Map a 3D point onto the 2D drawing frame of a slice.
 * Each mapping is a proper rotation (no mirror) that puts the +axis side of the
 * slice on the machine's top face, so etched marks always end up on the face that
 * the next layer in stacking order covers.
 *   X: drawing (x, y) = (Y, Z)   since Y × Z = +X
 *   Y: drawing (x, y) = (-X, Z)  since -X × Z = +Y
 *   Z: drawing (x, y) = (X, Y)   since X × Y = +Z
 */
function planar(v: THREE.Vector3, axis: Axis): Point2 {
  if (axis === 'X') return { x: v.y, y: v.z };
  if (axis === 'Y') return { x: -v.x, y: v.z };
  return { x: v.x, y: v.y };
}

function interpolate(a: THREE.Vector3, b: THREE.Vector3, da: number, db: number) {
  const t = da / (da - db);
  return a.clone().lerp(b, t);
}

function key(p: Point2, tol: number) {
  return `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
}

function stitchSegments(segments: [Point2, Point2][], tolerance: number): Polyline[] {
  const adjacency = new Map<string, { point: Point2; segment: number; end: 0 | 1 }[]>();
  segments.forEach((seg, i) => seg.forEach((p, end) => {
    const k = key(p, tolerance);
    const list = adjacency.get(k) ?? [];
    list.push({ point: p, segment: i, end: end as 0 | 1 });
    adjacency.set(k, list);
  }));
  const used = new Uint8Array(segments.length);
  const loops: Polyline[] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const loop: Point2[] = [{ ...segments[s][0] }, { ...segments[s][1] }];
    let current = segments[s][1];
    const startKey = key(segments[s][0], tolerance);
    let guard = 0;
    while (key(current, tolerance) !== startKey && guard++ < segments.length + 5) {
      const choices = adjacency.get(key(current, tolerance)) ?? [];
      const next = choices.find(c => !used[c.segment]);
      if (!next) break;
      used[next.segment] = 1;
      const seg = segments[next.segment];
      current = next.end === 0 ? seg[1] : seg[0];
      loop.push({ ...current });
    }
    if (loop.length >= 4 && key(loop[0], tolerance) === key(loop[loop.length - 1], tolerance)) {
      loop.pop();
      loops.push(loop);
    }
  }
  return loops;
}

/** Group closed loops into outer/hole regions by area order and centroid containment. */
export function regionsFromLoops(loops: Polyline[]): SectionRegion[] {
  const sorted = loops.filter(p => p.length >= 3 && area(p) > 1e-8).sort((a, b) => area(b) - area(a));
  const regions: SectionRegion[] = [];
  for (const loop of sorted) {
    const c = centroid(loop);
    const parent = regions.find(r => pointInPolygon(c, r.outer));
    if (parent) parent.holes.push(ensureCW(loop));
    else regions.push({ outer: ensureCCW(loop), holes: [] });
  }
  return regions;
}

function classifyLoops(loops: Polyline[]): SectionRegion[] {
  const sorted = loops.filter(p => p.length >= 3 && area(p) > 1e-7).sort((a, b) => area(b) - area(a));
  const depth = sorted.map((poly, i) => {
    const c = centroid(poly);
    let d = 0;
    for (let j = 0; j < i; j++) if (pointInPolygon(c, sorted[j])) d++;
    return d;
  });
  const regions: SectionRegion[] = [];
  sorted.forEach((poly, i) => {
    if (depth[i] % 2 === 0) regions.push({ outer: ensureCCW(poly), holes: [] });
    else {
      const c = centroid(poly);
      const parent = [...regions].reverse().find(r => pointInPolygon(c, r.outer));
      if (parent) parent.holes.push(ensureCW(poly));
    }
  });
  return regions;
}

export function transformedGeometryVertices(
  geometry: THREE.BufferGeometry,
  rotationDeg: { x: number; y: number; z: number },
  axis: Axis,
  achievedHeight: number
) {
  return prepareGeometry(geometry, { rotationDeg, scaleAxis: axis, scaleTo: achievedHeight });
}

/**
 * Rotate, uniformly scale so the extent along scaleAxis equals scaleTo, optionally
 * compress depth (Z) toward the front face, then centre the result on the origin.
 */
export function prepareGeometry(
  geometry: THREE.BufferGeometry,
  options: {
    rotationDeg: { x: number; y: number; z: number };
    scaleAxis: Axis;
    scaleTo: number;
    depthScale?: number;
  }
) {
  const g = geometry.clone();
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(options.rotationDeg.x),
    THREE.MathUtils.degToRad(options.rotationDeg.y),
    THREE.MathUtils.degToRad(options.rotationDeg.z),
    'XYZ'
  );
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
  g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  const dimension = options.scaleAxis === 'X' ? size.x : options.scaleAxis === 'Y' ? size.y : size.z;
  const scale = dimension > 0 ? options.scaleTo / dimension : 1;
  g.scale(scale, scale, scale);
  g.computeBoundingBox();
  const depthScale = options.depthScale ?? 1;
  if (depthScale > 0 && Math.abs(depthScale - 1) > 1e-9) {
    // Compress toward the front face (max Z) so the nose stays where it is.
    const front = g.boundingBox!.max.z;
    g.translate(0, 0, -front);
    g.scale(1, 1, depthScale);
    g.translate(0, 0, front);
    g.computeBoundingBox();
  }
  const center = new THREE.Vector3();
  g.boundingBox!.getCenter(center);
  g.translate(-center.x, -center.y, -center.z);
  g.computeBoundingBox();
  return g;
}

export function sectionGeometry(
  geometry: THREE.BufferGeometry,
  planePosition: number,
  axis: Axis,
  simplifyTolerance: number
): SectionRegion[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const idx = geometry.index;
  const triangles = idx ? idx.count / 3 : pos.count / 3;
  const segments: [Point2, Point2][] = [];
  const eps = 1e-8;
  const verts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < triangles; t++) {
    for (let j = 0; j < 3; j++) {
      const vi = idx ? idx.getX(t * 3 + j) : t * 3 + j;
      verts[j].fromBufferAttribute(pos, vi);
    }
    const d = verts.map(v => axisCoord(v, axis) - planePosition);
    const hits: THREE.Vector3[] = [];
    for (let e = 0; e < 3; e++) {
      const n = (e + 1) % 3;
      if (Math.abs(d[e]) < eps && Math.abs(d[n]) < eps) continue;
      if (Math.abs(d[e]) < eps) hits.push(verts[e].clone());
      else if ((d[e] < 0 && d[n] > 0) || (d[e] > 0 && d[n] < 0)) hits.push(interpolate(verts[e], verts[n], d[e], d[n]));
    }
    const unique: THREE.Vector3[] = [];
    for (const h of hits) if (!unique.some(u => u.distanceToSquared(h) < 1e-14)) unique.push(h);
    if (unique.length === 2) segments.push([planar(unique[0], axis), planar(unique[1], axis)]);
  }
  const loops = stitchSegments(segments, Math.max(1e-5, simplifyTolerance * 0.1))
    .map(p => simplifyRdp(p, simplifyTolerance));
  return classifyLoops(loops);
}
