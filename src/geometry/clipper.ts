import ClipperLib from 'clipper-lib';
import type { Polyline } from '../types';
import { area, ensureCCW, openPolyline } from './polygon';

const SCALE = 100000;
type CPath = { X: number; Y: number }[];

const toPath = (poly: Polyline): CPath => openPolyline(poly).map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path: CPath): Polyline => path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
const toPaths = (polys: Polyline[]) => polys.filter(p => p.length >= 3).map(toPath);
const fromPaths = (paths: CPath[]): Polyline[] => paths.map(fromPath).filter(p => p.length >= 3 && area(p) > 1e-8);

export function offsetPolygons(polys: Polyline[], delta: number): Polyline[] {
  if (!polys.length) return [];
  const co = new ClipperLib.ClipperOffset(2, 0.01 * SCALE);
  co.AddPaths(toPaths(polys), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const solution: CPath[] = [];
  co.Execute(solution, delta * SCALE);
  return fromPaths(solution).map(ensureCCW).sort((a, b) => area(b) - area(a));
}

function booleanOp(subject: Polyline[], clip: Polyline[], type: number): Polyline[] {
  if (!subject.length) return [];
  if (!clip.length && type === ClipperLib.ClipType.ctIntersection) return [];
  const c = new ClipperLib.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(toPaths(subject), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(toPaths(clip), ClipperLib.PolyType.ptClip, true);
  const solution: CPath[] = [];
  c.Execute(type, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromPaths(solution).sort((a, b) => area(b) - area(a));
}

export const unionPolygons = (polys: Polyline[]) => booleanOp(polys, [], ClipperLib.ClipType.ctUnion);
export const intersectPolygons = (a: Polyline[], b: Polyline[]) => booleanOp(a, b, ClipperLib.ClipType.ctIntersection);
export const differencePolygons = (a: Polyline[], b: Polyline[]) => booleanOp(a, b, ClipperLib.ClipType.ctDifference);

export function intersectMany(groups: Polyline[][]): Polyline[] {
  const nonEmpty = groups.filter(g => g.length);
  if (!nonEmpty.length) return [];
  return nonEmpty.slice(1).reduce((acc, group) => intersectPolygons(acc, group), nonEmpty[0]);
}
