import type { Part2D, Placement, Polyline, ProjectSettings, SheetLayout } from '../types';
import { circlePolyline, transformPolyline } from '../geometry/polygon';

const COLORS: Record<string, number> = {
  OUTER_CUT: 1,
  INNER_CUT: 5,
  DOWEL: 3,
  ETCH: 6,
  SHEET: 8
};

function pair(code: number, value: string | number) { return `${code}\n${value}\n`; }
function num(n: number) { return Number(n.toFixed(6)); }

function lwpolyline(layer: string, points: Polyline, closed: boolean) {
  if (points.length < (closed ? 3 : 2)) throw new Error(`${layer} contour has too few vertices.`);
  let out = pair(0, 'LWPOLYLINE') + pair(100, 'AcDbEntity') + pair(8, layer) + pair(62, COLORS[layer] ?? 7) +
    pair(100, 'AcDbPolyline') + pair(90, points.length) + pair(70, closed ? 1 : 0);
  for (const p of points) out += pair(10, num(p.x)) + pair(20, num(p.y));
  return out;
}

function header() {
  return pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1015') +
    pair(9, '$INSUNITS') + pair(70, 1) + pair(0, 'ENDSEC');
}

function tables() {
  const names = Object.keys(COLORS);
  let out = pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, names.length);
  for (const name of names) {
    out += pair(0, 'LAYER') + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbLayerTableRecord') + pair(2, name) + pair(70, 0) + pair(62, COLORS[name]) + pair(6, 'CONTINUOUS');
  }
  return out + pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
}

function partEntities(part: Part2D, placement: Placement, settings: ProjectSettings) {
  const t = (poly: Polyline) => transformPolyline(poly, placement.x, placement.y, placement.rotation);
  let out = lwpolyline('OUTER_CUT', t(part.outer), true);
  for (const hole of [...part.structuralHoles, ...part.hollowCuts]) out += lwpolyline('INNER_CUT', t(hole), true);
  for (const hole of part.dowels) out += lwpolyline('DOWEL', t(circlePolyline(hole, hole.diameter / 2, settings.chordTolerance)), true);
  for (const stroke of part.etch?.polylines ?? []) out += lwpolyline('ETCH', t(stroke), false);
  return out;
}

export function sheetToDxf(sheet: SheetLayout, parts: Part2D[], settings: ProjectSettings) {
  let entities = lwpolyline('SHEET', [
    { x: 0, y: 0 }, { x: sheet.width, y: 0 }, { x: sheet.width, y: sheet.height }, { x: 0, y: sheet.height }
  ], true);
  for (const placement of sheet.placements) {
    const part = parts.find(p => p.id === placement.partId);
    if (!part) throw new Error(`Missing part ${placement.partId} during DXF export.`);
    entities += partEntities(part, placement, settings);
  }
  return header() + tables() + pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities + pair(0, 'ENDSEC') + pair(0, 'EOF');
}
