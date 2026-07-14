import JSZip from 'jszip';
import type { PipelineResult, ProjectSettings, SourceAsset } from '../types';
import { sheetToDxf } from './dxf';
import { sheetToSvg } from './svg';
import { makeProject } from './project';
import { downloadBlob } from '../utils/files';

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
  zip.file(`${safe}_sheet-map.csv`, ['sheet,part,layer,rotation,x,y,nested_in', ...result.sheets.flatMap(sheet => sheet.placements.map(p => {
    const part = parts.find(x => x.id === p.partId)!;
    return [sheet.index + 1, part.label, part.layerIndex + 1, p.rotation, p.x.toFixed(4), p.y.toFixed(4), p.nestedInPartId ?? ''].join(',');
  }))].join('\n'));
  downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), `${safe}.zip`);
}
