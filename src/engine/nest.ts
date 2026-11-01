import type { Part2D, Placement, Polyline, Rotation, SheetLayout } from '../types';
import { area, bounds, pointInPolygon, rotatePoint } from '../geometry/polygon';
import { offsetPolygons } from '../geometry/clipper';

/** Raster resolution of the packing skyline, in inches. */
const RES = 0.1;

interface Profile {
  part: Part2D;
  rotation: Rotation;
  /** Rotated outline, expanded bounding box starts at (minX, minY). */
  pts: Polyline;
  minX: number;
  minY: number;
  width: number;
  height: number;
  /** Per column, lowest and highest filled y relative to the expanded bounding box bottom. */
  bottom: Float64Array;
  top: Float64Array;
  cols: number;
}

function profile(part: Part2D, rotation: Rotation, gap: number): Profile {
  const pts = part.outer.map(p => rotatePoint(p, rotation));
  const b = bounds(pts);
  const half = gap / 2;
  const width = b.width + gap, height = b.height + gap;
  const cols = Math.max(1, Math.ceil(width / RES));
  const bottom = new Float64Array(cols);
  const top = new Float64Array(cols);
  const n = pts.length;
  for (let c = 0; c < cols; c++) {
    const x = b.minX - half + (c + 0.5) * RES;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const x0 = Math.min(p.x, q.x) - half, x1 = Math.max(p.x, q.x) + half;
      if (x < x0 || x > x1) continue;
      if (Math.abs(q.x - p.x) < 1e-9) { lo = Math.min(lo, p.y, q.y); hi = Math.max(hi, p.y, q.y); continue; }
      const tx = Math.max(0, Math.min(1, (Math.max(p.x, Math.min(q.x, x)) - p.x) / (q.x - p.x)));
      const y = p.y + tx * (q.y - p.y);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (!Number.isFinite(lo)) { lo = b.minY; hi = b.maxY; }
    bottom[c] = lo - b.minY;
    top[c] = hi - b.minY + gap;
  }
  return { part, rotation, pts, minX: b.minX - half, minY: b.minY - half, width, height, bottom, top, cols };
}

/** Something parts can be packed into: a sheet, or the hollow void of a part already on a sheet. */
interface Container {
  kind: 'sheet' | 'void';
  sheetIndex: number;
  hostId?: string;
  /** Origin of the packing area in the container's own coordinates. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** For voids: the polygon every nested outline must stay inside (container coordinates). */
  polygon?: Polyline;
  skyline: Float64Array;
  placements: Placement[];
}

function makeContainer(kind: Container['kind'], sheetIndex: number, originX: number, originY: number, width: number, height: number, polygon?: Polyline, hostId?: string): Container {
  return { kind, sheetIndex, hostId, originX, originY, width, height, polygon, skyline: new Float64Array(Math.max(1, Math.floor(width / RES))), placements: [] };
}

function tryPlace(container: Container, profiles: Profile[]) {
  const cols = container.skyline.length;
  let best: { y: number; col: number; prof: Profile } | null = null;
  for (const prof of profiles) {
    if (prof.cols > cols || prof.height > container.height + 1e-9) continue;
    const maxCol = cols - prof.cols;
    for (let col = 0; col <= maxCol; col++) {
      let y = 0;
      for (let c = 0; c < prof.cols; c++) {
        const need = container.skyline[col + c] - prof.bottom[c];
        if (need > y) y = need;
        if (best && y >= best.y) break;
      }
      if (best && y >= best.y) continue;
      if (y + prof.height > container.height + 1e-9) continue;
      if (container.polygon) {
        // Every outline point must stay inside the void (already inset by the gap).
        const dx = container.originX + col * RES - prof.minX, dy = container.originY + y - prof.minY;
        const inside = prof.pts.every(p => pointInPolygon({ x: p.x + dx, y: p.y + dy }, container.polygon!));
        if (!inside) continue;
      }
      best = { y, col, prof };
    }
  }
  return best;
}

/**
 * Skyline packer that works on part outlines instead of bounding boxes, so triangular slabs
 * interlock (one apex up, the next apex down) instead of wasting the corners of each box.
 * Large parts go down first; smaller parts are tried inside the hollow voids of parts already on
 * a sheet, then on every open sheet (first fit), and only then on a new sheet.
 */
export function nestParts(parts: Part2D[], options: {
  width: number;
  height: number;
  margin: number;
  gap: number;
  rotate90: boolean;
  nestInCutouts: boolean;
}): SheetLayout[] {
  const sorted = [...parts].sort((a, b) => area(b.outer) - area(a.outer));
  const innerW = options.width - 2 * options.margin;
  const innerH = options.height - 2 * options.margin;
  const sheets: Container[] = [];
  const voids: Container[] = [];
  const placements: Placement[] = [];

  for (const part of sorted) {
    const rotations: Rotation[] = options.rotate90 ? [0, 180, 90, 270] : [0, 180];
    const profiles = rotations.map(r => profile(part, r, options.gap));
    let placed: Placement | null = null;

    if (options.nestInCutouts) {
      for (const v of voids) {
        const fit = tryPlace(v, profiles);
        if (!fit) continue;
        placed = { partId: part.id, sheetIndex: -1, x: v.originX + fit.col * RES - fit.prof.minX, y: v.originY + fit.y - fit.prof.minY, rotation: fit.prof.rotation, nestedInPartId: v.hostId };
        for (let c = 0; c < fit.prof.cols; c++) v.skyline[fit.col + c] = Math.max(v.skyline[fit.col + c], fit.y + fit.prof.top[c]);
        v.placements.push(placed);
        break;
      }
    }

    for (let s = 0; s <= sheets.length && !placed; s++) {
      if (s === sheets.length) sheets.push(makeContainer('sheet', s, options.margin, options.margin, innerW, innerH));
      const sheet = sheets[s];
      const fit = tryPlace(sheet, profiles);
      if (!fit) {
        if (s === sheets.length - 1 && !sheet.placements.length) throw new Error(`${part.label} is larger than the configured sheet.`);
        continue;
      }
      placed = { partId: part.id, sheetIndex: s, x: sheet.originX + fit.col * RES - fit.prof.minX, y: sheet.originY + fit.y - fit.prof.minY, rotation: fit.prof.rotation };
      for (let c = 0; c < fit.prof.cols; c++) sheet.skyline[fit.col + c] = Math.max(sheet.skyline[fit.col + c], fit.y + fit.prof.top[c]);
      sheet.placements.push(placed);
      // This part's voids can now hold smaller parts (one level deep, in the host's own coordinates).
      if (options.nestInCutouts) {
        for (const hole of part.hollowCuts) {
          const inset = offsetPolygons([hole], -options.gap)[0];
          if (!inset) continue;
          const hb = bounds(inset);
          if (hb.width < 0.5 || hb.height < 0.5) continue;
          voids.push(makeContainer('void', -1, hb.minX, hb.minY, hb.width, hb.height, inset, part.id));
        }
      }
    }
    if (placed) placements.push(placed);
  }

  const layouts: SheetLayout[] = sheets.map((sheet, index) => ({ index, width: options.width, height: options.height, placements: [...sheet.placements], utilization: 0 }));

  // Compose nested placements with their host's placement on the sheet.
  for (const p of placements) {
    if (!p.nestedInPartId) continue;
    const host = placements.find(q => q.partId === p.nestedInPartId);
    if (!host || host.sheetIndex < 0) continue;
    const local = rotatePoint({ x: p.x, y: p.y }, host.rotation);
    p.sheetIndex = host.sheetIndex;
    p.x = local.x + host.x;
    p.y = local.y + host.y;
    p.rotation = ((p.rotation + host.rotation) % 360) as Rotation;
    layouts[p.sheetIndex].placements.push(p);
  }

  for (const layout of layouts) {
    const used = layout.placements.reduce((sum, p) => {
      const part = parts.find(q => q.id === p.partId)!;
      return sum + area(part.outer) - part.hollowCuts.reduce((n, h) => n + area(h), 0);
    }, 0);
    layout.utilization = Math.max(0, Math.min(1, used / (options.width * options.height)));
  }
  return layouts;
}
