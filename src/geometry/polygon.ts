import type { Point2, Polyline } from '../types';

export const EPS = 1e-6;

export function closePolyline(poly: Polyline): Polyline {
  if (poly.length < 2) return poly.slice();
  const a = poly[0];
  const b = poly[poly.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) <= EPS) return poly.slice();
  return [...poly, { ...a }];
}

export function openPolyline(poly: Polyline): Polyline {
  if (poly.length < 2) return poly.slice();
  const a = poly[0];
  const b = poly[poly.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) <= EPS ? poly.slice(0, -1) : poly.slice();
}

export function signedArea(poly: Polyline): number {
  const p = openPolyline(poly);
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function area(poly: Polyline): number {
  return Math.abs(signedArea(poly));
}

export function ensureCCW(poly: Polyline): Polyline {
  const p = openPolyline(poly);
  return signedArea(p) < 0 ? p.reverse() : p;
}

export function ensureCW(poly: Polyline): Polyline {
  const p = openPolyline(poly);
  return signedArea(p) > 0 ? p.reverse() : p;
}

export function bounds(poly: Polyline) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function centroid(poly: Polyline): Point2 {
  const p = openPolyline(poly);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const cross = p[i].x * q.y - q.x * p[i].y;
    a += cross;
    cx += (p[i].x + q.x) * cross;
    cy += (p[i].y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < EPS) {
    const b = bounds(p);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(point: Point2, poly: Polyline): boolean {
  const p = openPolyline(poly);
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i].x, yi = p[i].y;
    const xj = p[j].x, yj = p[j].y;
    const hit = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || EPS) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

export function pointInSolid(point: Point2, outer: Polyline, holes: Polyline[]): boolean {
  return pointInPolygon(point, outer) && !holes.some(h => pointInPolygon(point, h));
}

export function distancePointSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToEdges(point: Point2, polys: Polyline[]): number {
  let best = Infinity;
  for (const poly of polys) {
    const p = openPolyline(poly);
    for (let i = 0; i < p.length; i++) best = Math.min(best, distancePointSegment(point, p[i], p[(i + 1) % p.length]));
  }
  return best;
}

export function simplifyRdp(points: Polyline, tolerance: number): Polyline {
  const p = openPolyline(points);
  if (p.length < 4) return p;
  const sqTol = tolerance * tolerance;
  const sqSegDist = (pt: Point2, a: Point2, b: Point2) => {
    let x = a.x, y = a.y;
    let dx = b.x - x, dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((pt.x - x) * dx + (pt.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.x; y = b.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = pt.x - x; dy = pt.y - y;
    return dx * dx + dy * dy;
  };
  const markers = new Uint8Array(p.length);
  markers[0] = markers[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let max = sqTol, index = 0;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(p[i], p[first], p[last]);
      if (d > max) { index = i; max = d; }
    }
    if (index) { markers[index] = 1; stack.push([first, index], [index, last]); }
  }
  return p.filter((_, i) => markers[i] === 1);
}

export function rotatePoint(p: Point2, rotation: 0 | 90): Point2 {
  return rotation === 90 ? { x: -p.y, y: p.x } : { ...p };
}

export function transformPolyline(poly: Polyline, x: number, y: number, rotation: 0 | 90): Polyline {
  return poly.map(p => {
    const r = rotatePoint(p, rotation);
    return { x: r.x + x, y: r.y + y };
  });
}

export function circlePolyline(center: Point2, radius: number, chordTolerance = 0.005): Polyline {
  const theta = radius > chordTolerance
    ? 2 * Math.acos(Math.max(-1, Math.min(1, 1 - chordTolerance / radius)))
    : Math.PI / 8;
  const segments = Math.max(16, Math.ceil((2 * Math.PI) / Math.max(theta, Math.PI / 64)));
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
  });
}

export function normalizeToOrigin(poly: Polyline) {
  const b = bounds(poly);
  return poly.map(p => ({ x: p.x - b.minX, y: p.y - b.minY }));
}
