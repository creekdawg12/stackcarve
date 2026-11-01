import type { Part2D, Point2, Polyline, StrokeMark } from '../types';
import { bounds, pointInPolygon, pointInSolid } from '../geometry/polygon';

// Compact single-stroke simplex glyphs. Coordinates use a 0..1 cap-height grid.
const G: Record<string, number[][][]> = {
  '0': [[[.15,.1],[.05,.25],[.05,.75],[.15,.9],[.75,.9],[.85,.75],[.85,.25],[.75,.1],[.15,.1]]],
  '1': [[[.25,.7],[.45,.9],[.45,.1]],[[.2,.1],[.7,.1]]],
  '2': [[[.05,.7],[.15,.9],[.7,.9],[.85,.75],[.8,.6],[.05,.1],[.85,.1]]],
  '3': [[[.05,.85],[.75,.9],[.85,.75],[.55,.52],[.85,.3],[.75,.1],[.05,.15]]],
  '4': [[[.7,.1],[.7,.9]],[[.05,.35],[.85,.35]],[[.05,.35],[.55,.9]]],
  '5': [[[.85,.9],[.1,.9],[.05,.55],[.65,.55],[.85,.4],[.8,.2],[.65,.1],[.05,.15]]],
  '6': [[[.8,.85],[.65,.9],[.2,.85],[.05,.55],[.1,.2],[.25,.1],[.7,.1],[.85,.3],[.75,.5],[.1,.5]]],
  '7': [[[.05,.9],[.85,.9],[.35,.1]]],
  '8': [[[.2,.5],[.05,.65],[.15,.9],[.7,.9],[.85,.7],[.7,.5],[.2,.5],[.05,.3],[.2,.1],[.7,.1],[.85,.3],[.7,.5]]],
  '9': [[[.8,.5],[.15,.5],[.05,.7],[.2,.9],[.7,.9],[.85,.75],[.8,.25],[.65,.1],[.15,.15]]],
  '/': [[[.05,.05],[.75,.95]]],
  'A': [[[.05,.1],[.45,.9],[.85,.1]],[[.2,.45],[.7,.45]]],
  'B': [[[.05,.1],[.05,.9],[.55,.9],[.8,.75],[.55,.52],[.05,.52]],[[.55,.52],[.82,.35],[.65,.1],[.05,.1]]],
  'C': [[[.85,.8],[.7,.9],[.2,.9],[.05,.7],[.05,.3],[.2,.1],[.7,.1],[.85,.2]]],
  'D': [[[.05,.1],[.05,.9],[.5,.9],[.85,.7],[.85,.3],[.5,.1],[.05,.1]]],
  'E': [[[.8,.9],[.05,.9],[.05,.1],[.8,.1]],[[.05,.52],[.65,.52]]],
  'F': [[[.05,.1],[.05,.9],[.8,.9]],[[.05,.52],[.65,.52]]],
  'G': [[[.85,.78],[.68,.9],[.2,.9],[.05,.7],[.05,.3],[.2,.1],[.7,.1],[.85,.28],[.85,.48],[.52,.48]]],
  'H': [[[.05,.1],[.05,.9]],[[.85,.1],[.85,.9]],[[.05,.5],[.85,.5]]],
  'I': [[[.1,.9],[.8,.9]],[[.45,.9],[.45,.1]],[[.1,.1],[.8,.1]]],
  'J': [[[.1,.9],[.8,.9]],[[.62,.9],[.62,.28],[.5,.1],[.2,.1],[.05,.28]]],
  'K': [[[.05,.1],[.05,.9]],[[.82,.9],[.05,.46],[.82,.1]]],
  'L': [[[.05,.9],[.05,.1],[.82,.1]]],
  'M': [[[.05,.1],[.05,.9],[.45,.5],[.85,.9],[.85,.1]]],
  'N': [[[.05,.1],[.05,.9],[.85,.1],[.85,.9]]],
  'O': [[[.18,.1],[.05,.28],[.05,.72],[.18,.9],[.72,.9],[.85,.72],[.85,.28],[.72,.1],[.18,.1]]],
  'P': [[[.05,.1],[.05,.9],[.62,.9],[.85,.72],[.62,.52],[.05,.52]]],
  'Q': [[[.18,.1],[.05,.28],[.05,.72],[.18,.9],[.72,.9],[.85,.72],[.85,.28],[.72,.1],[.18,.1]],[[.55,.32],[.88,.02]]],
  'R': [[[.05,.1],[.05,.9],[.62,.9],[.85,.72],[.62,.52],[.05,.52]],[[.5,.52],[.85,.1]]],
  'S': [[[.82,.82],[.68,.9],[.2,.9],[.05,.72],[.18,.55],[.68,.45],[.85,.28],[.72,.1],[.18,.1],[.05,.18]]],
  'T': [[[.05,.9],[.85,.9]],[[.45,.9],[.45,.1]]],
  'U': [[[.05,.9],[.05,.28],[.18,.1],[.72,.1],[.85,.28],[.85,.9]]],
  'V': [[[.05,.9],[.45,.1],[.85,.9]]],
  'W': [[[.05,.9],[.2,.1],[.45,.5],[.7,.1],[.85,.9]]],
  'X': [[[.05,.9],[.85,.1]],[[.85,.9],[.05,.1]]],
  'Y': [[[.05,.9],[.45,.52],[.85,.9]],[[.45,.52],[.45,.1]]],
  'Z': [[[.05,.9],[.85,.9],[.05,.1],[.85,.1]]]
};

function makeText(text: string, height: number): Polyline[] {
  const width = height * 0.72;
  const gap = height * 0.18;
  let x = 0;
  const lines: Polyline[] = [];
  for (const ch of text) {
    const glyph = G[ch] ?? G['0'];
    for (const stroke of glyph) lines.push(stroke.map(([gx, gy]) => ({ x: x + gx * width, y: gy * height })));
    x += width + gap;
  }
  return lines;
}

function translated(lines: Polyline[], origin: Point2): Polyline[] {
  return lines.map(line => line.map(p => ({ x: p.x + origin.x, y: p.y + origin.y })));
}

function fits(part: Part2D, lines: Polyline[], dowelClearance: number, zones?: Polyline[]) {
  const holes = [...part.structuralHoles, ...part.hollowCuts];
  return lines.every(line => line.every(p => pointInSolid(p, part.outer, holes) &&
    (!zones || zones.some(z => pointInPolygon(p, z))) &&
    part.dowels.every(d => Math.hypot(p.x - d.x, p.y - d.y) > d.diameter / 2 + dowelClearance)));
}

function glyphLines(text: string, h: number): Polyline[] {
  const raw = makeText(text, h);
  const rb = bounds(raw.flat());
  const arrow: Polyline[] = [
    [{ x: rb.maxX + h * .35, y: 0 }, { x: rb.maxX + h * .35, y: h * .9 }],
    [{ x: rb.maxX + h * .35, y: h * .9 }, { x: rb.maxX + h * .18, y: h * .68 }],
    [{ x: rb.maxX + h * .35, y: h * .9 }, { x: rb.maxX + h * .52, y: h * .68 }]
  ];
  return [...raw, ...arrow];
}

function zoneOrigins(zones: Polyline[], spacing: number): Point2[] {
  const out: Point2[] = [];
  for (const zone of zones) {
    const b = bounds(zone);
    out.push({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    for (let y = b.minY + spacing / 2; y <= b.maxY; y += spacing) for (let x = b.minX + spacing / 2; x <= b.maxX; x += spacing) {
      const p = { x, y };
      if (pointInPolygon(p, zone)) out.push(p);
    }
  }
  return out;
}

/**
 * Lay the label down as single-stroke polylines that fit in solid material, clear of dowels.
 * Preferred zones (regions the next layer hides) are tried first; with requireZone the mark is
 * omitted rather than placed where it would show on the finished piece.
 */
export function buildEtch(part: Part2D, text: string, defaultHeight: number, minHeight: number, options: { zones?: Polyline[]; requireZone?: boolean } = {}): StrokeMark {
  const b = bounds(part.outer);
  const fallback = [
    { x: b.minX + b.width * .5, y: b.minY + b.height * .5 },
    { x: b.minX + b.width * .3, y: b.minY + b.height * .3 },
    { x: b.minX + b.width * .7, y: b.minY + b.height * .3 },
    { x: b.minX + b.width * .5, y: b.minY + b.height * .72 }
  ];
  const zones = options.zones?.filter(z => z.length >= 3) ?? [];
  for (let h = defaultHeight; h >= minHeight - 1e-6; h -= 0.05) {
    const combined = glyphLines(text, h);
    const cb = bounds(combined.flat());
    const place = (c: Point2) => translated(combined, { x: c.x - (cb.minX + cb.maxX) / 2, y: c.y - (cb.minY + cb.maxY) / 2 });
    if (zones.length) {
      for (const c of zoneOrigins(zones, Math.max(h * 0.6, 0.15))) {
        const lines = place(c);
        if (fits(part, lines, 0.08, zones)) return { polylines: lines, text, height: h };
      }
    }
    if (!options.requireZone) {
      for (const c of fallback) {
        const lines = place(c);
        if (fits(part, lines, 0.08)) return { polylines: lines, text, height: h };
      }
    }
  }
  return { polylines: [], text, height: minHeight, omitted: true };
}
