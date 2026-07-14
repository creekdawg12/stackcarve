import type { Part2D, Placement, Polyline, ProjectSettings, SheetLayout } from '../types';
import { circlePolyline, transformPolyline } from '../geometry/polygon';

const style: Record<string, string> = {
  OUTER_CUT: '#ff5c57',
  INNER_CUT: '#4da3ff',
  DOWEL: '#58d68d',
  ETCH: '#d889ff',
  SHEET: '#8d969f'
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
function path(poly: Polyline, height: number, closed: boolean) {
  if (poly.length < (closed ? 3 : 2)) throw new Error('Open or invalid contour blocked during SVG export.');
  return poly.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(5)} ${(height - p.y).toFixed(5)}`).join(' ') + (closed ? ' Z' : '');
}
function line(layer: string, d: string) { return `<path data-layer="${layer}" d="${d}" fill="none" stroke="${style[layer]}" stroke-width="0.01" vector-effect="non-scaling-stroke"/>`; }

function partSvg(part: Part2D, placement: Placement, sheetHeight: number, settings: ProjectSettings) {
  const t = (p: Polyline) => transformPolyline(p, placement.x, placement.y, placement.rotation);
  let out = line('OUTER_CUT', path(t(part.outer), sheetHeight, true));
  for (const h of [...part.structuralHoles, ...part.hollowCuts]) out += line('INNER_CUT', path(t(h), sheetHeight, true));
  for (const d of part.dowels) out += line('DOWEL', path(t(circlePolyline(d, d.diameter / 2, settings.chordTolerance)), sheetHeight, true));
  for (const e of part.etch?.polylines ?? []) out += line('ETCH', path(t(e), sheetHeight, false));
  return `<g id="part-${esc(part.label)}">${out}</g>`;
}

export function sheetToSvg(sheet: SheetLayout, parts: Part2D[], settings: ProjectSettings) {
  const outline = line('SHEET', path([{ x: 0, y: 0 }, { x: sheet.width, y: 0 }, { x: sheet.width, y: sheet.height }, { x: 0, y: sheet.height }], sheet.height, true));
  const body = sheet.placements.map(p => {
    const part = parts.find(x => x.id === p.partId);
    if (!part) throw new Error(`Missing part ${p.partId} during SVG export.`);
    return partSvg(part, p, sheet.height, settings);
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}in" height="${sheet.height}in" viewBox="0 0 ${sheet.width} ${sheet.height}"><title>StackCarve Sheet ${sheet.index + 1}</title><g fill="none" stroke-linejoin="round" stroke-linecap="round">${outline}${body}</g></svg>`;
}
