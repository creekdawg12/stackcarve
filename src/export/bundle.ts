import JSZip from 'jszip';
import type { PipelineResult, ProjectSettings, SourceAsset } from '../types';
import { sheetToDxf } from './dxf';
import { sheetToSvg } from './svg';
import { makeProject } from './project';
import { downloadBlob } from '../utils/files';
import { buildChecklist, checklistText } from './checklist';

export async function exportAll(name: string, result: PipelineResult, settings: ProjectSettings, sourceAsset: SourceAsset | null) {
  const safe = name.trim().replace(/[^a-z0-9_-]+/gi, '_') || 'stackcarve';
  const parts = result.layers.flatMap(l => l.parts);
  const zip = new JSZip();
  result.sheets.forEach(sheet => {
    const n = String(sheet.index + 1).padStart(2, '0');
    zip.file(`${safe}_sheet_${n}.dxf`, sheetToDxf(sheet, parts, settings));
    zip.file(`${safe}_sheet_${n}.svg`, sheetToSvg(sheet, parts, settings));
  });
  zip.file(`${safe}.stackcarve.json`, JSON.stringify(makeProject(name, settings, sourceAsset, result), null, 2));
  const pieces = result.layers.filter(l => l.parts.some(p => p.role !== 'backer')).length;
  const notes = [
    `StackCarve assembly notes — ${name}`,
    `Mode: ${result.buildMode}`,
    `Pieces: ${pieces} ${result.buildMode === 'slabs' ? 'slabs' : 'layers'} of ${settings.materialThickness} in stock`,
    `Finished height: ${result.achievedHeight.toFixed(3)} in, depth off the wall: ${result.achievedDepth.toFixed(3)} in`,
    `Sheets: ${result.sheets.length} × ${settings.sheetWidth} × ${settings.sheetHeight} in (${result.stockSheets} four-by-eight stock sheets)`,
    ''
  ];
  if (result.buildMode === 'slabs') {
    const gap = result.pitch - settings.materialThickness;
    notes.push(result.slabDirection === 'vertical'
      ? `Vertical slabs: stack 1 (viewer's left) to ${pieces} (right), flat back edges against a straight board.`
      : `Horizontal slabs: stack 1 (bottom) to ${pieces} (top), flat back edges against a straight board.`);
    if (gap > 1e-6) notes.push(`Slabs are spaced ${gap.toFixed(3)} in apart. Slide one spacer sleeve (inner diameter to suit the rod, ${gap.toFixed(3)} in long) onto each rod between neighbouring slabs. Spacer totals: ${result.rods.map(r => `${r.columnId} × ${r.spacerCount}`).join(', ') || 'none'}.`);
    for (const r of result.rods) notes.push(`Rod ${r.columnId}: x = ${r.x.toFixed(3)} in in slab coordinates, ${r.offBack.toFixed(3)} in off the back edge, hole Ø ${r.holeDiameter.toFixed(3)} in, runs through slabs ${r.fromLayer + 1} to ${r.toLayer + 1}, cut ${r.length.toFixed(2)} in long.`);
    if (!result.rods.length) notes.push('No rods fit: glue slabs by eye against the back edge.');
  } else if (result.buildMode === 'terraced') {
    notes.push('Layer 1 goes against the wall. Pins are short dowels (two thicknesses long) pressed into the matching holes of neighbouring layers.');
  } else {
    notes.push('Stack layers bottom (1) to top on the dowel columns listed in the DOWEL layer.');
  }
  notes.push('', 'BEFORE YOU CUT', checklistText(buildChecklist(result, settings)));
  notes.push('', 'Warnings at export time:', ...result.warnings.map(w => `- [${w.severity}] ${w.message}`));
  zip.file(`${safe}_assembly.txt`, notes.join('\n'));
  zip.file(`${safe}_sheet-map.csv`, ['sheet,part,layer,rotation,x,y,nested_in', ...result.sheets.flatMap(sheet => sheet.placements.map(p => {
    const part = parts.find(x => x.id === p.partId)!;
    return [sheet.index + 1, part.label, part.layerIndex + 1, p.rotation, p.x.toFixed(4), p.y.toFixed(4), p.nestedInPartId ?? ''].join(',');
  }))].join('\n'));
  downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), `${safe}.zip`);
}
