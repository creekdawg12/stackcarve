import type { PipelineResult, ProjectSettings } from '../types';

export interface ChecklistItem {
  /** Short group heading. */
  group: string;
  text: string;
}

/** The pre-cut checklist shown on the Sheets tab and written into the ZIP. */
export function buildChecklist(result: PipelineResult, settings: ProjectSettings): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const slices = result.layers.filter(l => l.parts.some(p => p.role !== 'backer'));
  const parts = result.layers.flatMap(l => l.parts);
  const pieceWord = result.buildMode === 'slabs' ? 'slabs' : 'layers';
  const backers = parts.filter(p => p.role === 'backer').length;
  const gap = result.pitch - settings.materialThickness;
  const t = settings.materialThickness;

  items.push({ group: 'Stock', text: `${slices.length} ${pieceWord}${backers ? ` plus ${backers} backer plate${backers === 1 ? '' : 's'}` : ''} from ${t} in stock. Measure the sheet with calipers and make sure ${t} in matches, then recut if not.` });
  items.push({ group: 'Stock', text: `${result.sheets.length} sheet${result.sheets.length === 1 ? '' : 's'} of ${settings.sheetWidth} × ${settings.sheetHeight} in, which is ${result.stockSheets} four-by-eight sheet${result.stockSheets === 1 ? '' : 's'}.` });
  items.push({ group: 'Stock', text: `Finished size: ${result.buildMode === 'terraced' ? `${result.achievedDepth.toFixed(2)} in off the wall` : `${result.achievedHeight.toFixed(1)} in tall, ${result.achievedDepth.toFixed(2)} in deep`}.` });

  items.push({ group: 'CAM', text: 'DXF layers: OUTER_CUT (red) outside profile; INNER_CUT (blue) voids, cut these before the outer profile; DOWEL (green) holes, drill or bore to the drawn diameter; ETCH (purple) single-line engraving, V-bit or small end mill, shallow.' });
  items.push({ group: 'CAM', text: 'Geometry is nominal. Apply cutter compensation in CAM; nothing is pre-offset.' });
  if (t <= 0.3) items.push({ group: 'CAM', text: 'Thin stock: hold it down with tape and CA or tabs, and cut parts nested inside voids first.' });

  if (result.buildMode === 'slabs') {
    for (const r of result.rods) {
      items.push({ group: 'Rods', text: `Rod ${r.columnId}: cut ${r.length.toFixed(2)} in long, hole Ø${r.holeDiameter.toFixed(3)} in, runs through ${pieceWord} ${r.fromLayer + 1} to ${r.toLayer + 1}${r.spacerCount ? `, ${r.spacerCount} spacers × ${r.spacerLength.toFixed(3)} in` : ''}.` });
    }
    if (!result.rods.length) items.push({ group: 'Rods', text: 'No rod fits. Glue the slabs against a straight board instead.' });
    const glueOnly = result.warnings.find(w => w.id === 'rod-glue-only');
    if (glueOnly) items.push({ group: 'Rods', text: glueOnly.message });
    if (gap > 1e-6) items.push({ group: 'Rods', text: `Slabs are gapped ${gap.toFixed(3)} in. Total spacers: ${result.rods.reduce((n, r) => n + r.spacerCount, 0)} sleeves of ${gap.toFixed(3)} in, inner diameter to suit the rod.` });
    items.push({ group: 'Assembly', text: result.slabDirection === 'vertical'
      ? `Stack 1 (viewer's left) to ${slices.length} (right) on the rods, lying face down with the flat backs against a straight board. Glue, clamp, then fit the backer.`
      : `Stack 1 (bottom) to ${slices.length} (top) on the rods with the flat backs against a straight board. Glue, clamp, then fit the backer.` });
  } else if (result.buildMode === 'terraced') {
    const pinned = result.layers.flatMap(l => l.parts).reduce((n, p) => n + p.dowels.length, 0) / 2;
    items.push({ group: 'Pins', text: `${Math.round(pinned)} pin positions. Cut pins ${(2 * t).toFixed(3)} in long from ${settings.dowelDiameter} in dowel.` });
    const glue = result.warnings.find(w => w.id === 'pins-glue-only');
    if (glue) items.push({ group: 'Pins', text: glue.message });
    items.push({ group: 'Assembly', text: `Layer 1 goes on the wall. Dry-fit the whole stack on the pins before glue, then glue from the wall out, one layer at a time.` });
  } else {
    items.push({ group: 'Assembly', text: `Stack bottom (1) to top (${slices.length}) on the dowel columns. Dry-fit first.` });
  }

  const omitted = result.warnings.filter(w => /Etched label omitted/.test(w.message));
  if (omitted.length) items.push({ group: 'Labels', text: `Some parts have no etched number (${omitted.map(w => w.message.match(/\((\d+) parts?/)?.[1] ?? '1').join(' + ')}). Mark them from the sheet map CSV as they come off the machine.` });
  else items.push({ group: 'Labels', text: 'Every part carries an etched number and up arrow on a hidden face.' });

  const errors = result.warnings.filter(w => w.severity === 'error');
  for (const e of errors) items.push({ group: 'Fix first', text: e.message });
  return items;
}

export function checklistText(items: ChecklistItem[]) {
  const lines: string[] = [];
  let group = '';
  for (const it of items) {
    if (it.group !== group) { group = it.group; lines.push('', group.toUpperCase()); }
    lines.push(`[ ] ${it.text}`);
  }
  return lines.join('\n').trim();
}
