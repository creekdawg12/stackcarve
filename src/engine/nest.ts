import type { Part2D, Placement, SheetLayout } from '../types';
import { area, bounds, pointInPolygon, rotatePoint } from '../geometry/polygon';

interface Candidate {
  part: Part2D;
  rotation: 0 | 90;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function candidate(part: Part2D, rotation: 0 | 90): Candidate {
  const pts = part.outer.map(p => rotatePoint(p, rotation));
  const b = bounds(pts);
  return { part, rotation, minX: b.minX, minY: b.minY, width: b.width, height: b.height };
}

function fitsInsideHole(part: Part2D, host: Part2D, rotation: 0 | 90, gap: number) {
  const c = candidate(part, rotation);
  for (const hole of host.hollowCuts) {
    const hb = bounds(hole);
    const x = hb.minX + (hb.width - c.width) / 2 - c.minX;
    const y = hb.minY + (hb.height - c.height) / 2 - c.minY;
    const corners = [
      { x: x + c.minX - gap, y: y + c.minY - gap },
      { x: x + c.minX + c.width + gap, y: y + c.minY - gap },
      { x: x + c.minX + c.width + gap, y: y + c.minY + c.height + gap },
      { x: x + c.minX - gap, y: y + c.minY + c.height + gap }
    ];
    if (corners.every(p => pointInPolygon(p, hole))) return { x, y };
  }
  return null;
}

export function nestParts(parts: Part2D[], options: {
  width: number;
  height: number;
  margin: number;
  gap: number;
  rotate90: boolean;
  nestInCutouts: boolean;
}): SheetLayout[] {
  const sorted = [...parts].sort((a, b) => area(b.outer) - area(a.outer));
  const placements: Placement[] = [];
  const placedIds = new Set<string>();

  if (options.nestInCutouts) {
    const smallFirst = [...sorted].reverse();
    for (const part of smallFirst) {
      for (const host of sorted) {
        if (part.id === host.id || placedIds.has(host.id) || area(part.outer) > area(host.outer) * 0.45) continue;
        const rotations: (0 | 90)[] = options.rotate90 ? [0, 90] : [0];
        let found: { x: number; y: number; rotation: 0 | 90 } | null = null;
        for (const rotation of rotations) {
          const fit = fitsInsideHole(part, host, rotation, options.gap);
          if (fit) { found = { ...fit, rotation }; break; }
        }
        if (found) {
          placements.push({ partId: part.id, sheetIndex: -1, x: found.x, y: found.y, rotation: found.rotation, nestedInPartId: host.id });
          placedIds.add(part.id);
          break;
        }
      }
    }
  }

  const sheets: SheetLayout[] = [];
  const remaining = sorted.filter(p => !placedIds.has(p.id));
  const hostsWithNestedParts = new Set(placements.filter(p => p.nestedInPartId).map(p => p.nestedInPartId!));
  let sheetIndex = 0;
  let x = options.margin, y = options.margin, shelfHeight = 0;
  let sheetPlacements: Placement[] = [];

  const finishSheet = () => {
    if (!sheetPlacements.length) return;
    const sheetArea = options.width * options.height;
    const used = sheetPlacements.reduce((sum, p) => {
      const part = parts.find(q => q.id === p.partId)!;
      return sum + area(part.outer) - part.hollowCuts.reduce((n, h) => n + area(h), 0);
    }, 0);
    sheets.push({ index: sheetIndex, width: options.width, height: options.height, placements: [...sheetPlacements], utilization: Math.max(0, Math.min(1, used / sheetArea)) });
  };

  for (const part of remaining) {
    const choices = [candidate(part, 0), ...(options.rotate90 && !hostsWithNestedParts.has(part.id) ? [candidate(part, 90)] : [])];
    let c = choices.find(q => x + q.width <= options.width - options.margin && y + q.height <= options.height - options.margin);
    if (!c) {
      y += shelfHeight + options.gap;
      x = options.margin;
      shelfHeight = 0;
      c = choices.find(q => x + q.width <= options.width - options.margin && y + q.height <= options.height - options.margin);
    }
    if (!c) {
      finishSheet();
      sheetIndex++;
      sheetPlacements = [];
      x = y = options.margin;
      shelfHeight = 0;
      c = choices.find(q => q.width <= options.width - 2 * options.margin && q.height <= options.height - 2 * options.margin);
      if (!c) throw new Error(`${part.label} is larger than the configured sheet.`);
    }
    const placement: Placement = { partId: part.id, sheetIndex, x: x - c.minX, y: y - c.minY, rotation: c.rotation };
    sheetPlacements.push(placement);
    placements.push(placement);
    x += c.width + options.gap;
    shelfHeight = Math.max(shelfHeight, c.height);
  }
  finishSheet();

  for (const p of placements.filter(p => p.sheetIndex === -1)) {
    const hostPlacement = placements.find(q => q.partId === p.nestedInPartId);
    if (!hostPlacement) continue;
    const host = parts.find(q => q.id === p.nestedInPartId)!;
    const hp = candidate(host, hostPlacement.rotation);
    // Cutout nesting is currently restricted to unrotated hosts for exact local-coordinate reuse.
    if (hostPlacement.rotation !== 0) continue;
    p.sheetIndex = hostPlacement.sheetIndex;
    p.x += hostPlacement.x;
    p.y += hostPlacement.y;
    const sheet = sheets[p.sheetIndex];
    sheet.placements.push(p);
  }

  return sheets;
}
