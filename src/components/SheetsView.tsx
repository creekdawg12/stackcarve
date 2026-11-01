import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { centroid, circlePolyline, transformPolyline } from '../geometry/polygon';
import { sheetToDxf } from '../export/dxf';
import { sheetToSvg } from '../export/svg';
import { downloadBlob } from '../utils/files';
import { exportAll } from '../export/bundle';

function d(points: {x:number;y:number}[], closed = true) {
  return points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + (closed?' Z':'');
}

export function SheetsView({ projectName }: { projectName: string }) {
  const { result, settings, sourceAsset, selectedPartId, dispatch } = useStore();
  const [page, setPage] = useState(0);
  const parts = useMemo(() => result?.layers.flatMap(l => l.parts) ?? [], [result]);
  if (!result?.sheets.length) return <div className="viewport empty-state"><strong>No sheets yet</strong><span>Generate slices and nesting first.</span></div>;
  const index = Math.min(page, result.sheets.length - 1);
  const sheet = result.sheets[index];
  const exportSheet = (kind: 'dxf'|'svg') => {
    const text = kind === 'dxf' ? sheetToDxf(sheet, parts, settings) : sheetToSvg(sheet, parts, settings);
    downloadBlob(new Blob([text], { type: kind === 'dxf' ? 'application/dxf' : 'image/svg+xml' }), `${projectName || 'stackcarve'}_sheet_${String(index+1).padStart(2,'0')}.${kind}`);
  };
  return <div className="sheets-view">
    <div className="sheet-toolbar">
      <div className="pager"><button onClick={()=>setPage(Math.max(0,index-1))} disabled={index===0}>←</button><b>Sheet {index+1} / {result.sheets.length}</b><button onClick={()=>setPage(Math.min(result.sheets.length-1,index+1))} disabled={index===result.sheets.length-1}>→</button></div>
      <div className="export-actions"><button onClick={()=>exportSheet('dxf')}>DXF</button><button onClick={()=>exportSheet('svg')}>SVG</button><button className="primary" onClick={()=>exportAll(projectName,result,settings,sourceAsset)}>Export ZIP</button></div>
    </div>
    <div className="sheet-stage">
      <svg viewBox={`0 0 ${sheet.width} ${sheet.height}`} aria-label={`Sheet ${index+1}`}>
        <rect x="0" y="0" width={sheet.width} height={sheet.height} className="sheet-outline"/>
        <g transform={`translate(0 ${sheet.height}) scale(1 -1)`}>
          {sheet.placements.map(pl => {
            const part = parts.find(p=>p.id===pl.partId)!;
            const t=(poly:{x:number;y:number}[])=>transformPolyline(poly,pl.x,pl.y,pl.rotation);
            return <g key={pl.partId} className={part.id===selectedPartId?'part selected':'part'} onClick={()=>dispatch({type:'selectPart',id:part.id})}>
              <path className="outer" d={d(t(part.outer))}/>
              {[...part.structuralHoles,...part.hollowCuts].map((h,i)=><path className="inner" d={d(t(h))} key={`h${i}`}/>)}
              {part.dowels.map((hole,i)=><path className="dowel" d={d(t(circlePolyline(hole,hole.diameter/2,settings.chordTolerance)))} key={`d${i}`}/>)}
              {(part.etch?.polylines??[]).map((line,i)=><path className="etch" d={d(t(line),false)} key={`e${i}`}/>)}
            </g>;
          })}
        </g>
        {sheet.placements.map(pl=>{const part=parts.find(p=>p.id===pl.partId)!;const c=transformPolyline([centroid(part.outer)],pl.x,pl.y,pl.rotation)[0];return <text key={`t-${part.id}`} x={c.x} y={sheet.height-c.y} className="sheet-label">{part.label}</text>})}
      </svg>
    </div>
    <div className="sheet-stats"><span>{sheet.placements.length} parts</span><span>{(sheet.utilization*100).toFixed(1)}% material utilization</span><span>{settings.sheetWidth} × {settings.sheetHeight} in</span><span>{result.sheets.length} sheets = {result.stockSheets} × 4×8 stock</span></div>
    {(result.rods.length>0||result.buildMode!=='statue')&&<div className="assembly">
      {result.rods.map(r=><span key={r.columnId}><b>{r.columnId}</b> x = {r.x.toFixed(2)} in, {r.offBack.toFixed(2)} in off the back, through slabs {r.fromLayer+1} to {r.toLayer+1}, cut {r.length.toFixed(2)} in long, hole Ø{r.holeDiameter.toFixed(3)} in{r.spacerCount>0?`, ${r.spacerCount} spacers × ${r.spacerLength.toFixed(3)} in`:''}</span>)}
      {result.buildMode==='terraced'&&<span>Layer 1 goes against the wall. Pins are short dowels (2 × thickness) pressed into matching holes; every hole is covered by the layer two steps up.</span>}
      {result.buildMode==='slabs'&&<span>{result.slabDirection==='vertical'?`Stack slabs 1 (viewer's left) to ${result.layers.filter(l=>l.parts.some(p=>p.role!=='backer')).length} (right) on the rods, lying face down with the flat back edges against a straight board, then glue.`:`Stack slabs 1 (bottom) to ${result.layers.filter(l=>l.parts.some(p=>p.role!=='backer')).length} (top) on the rods with the flat back edges against a straight board, then glue.`}{result.pitch>result.layers[0]?.thickness+1e-9?` Slabs are gapped ${(result.pitch-result.layers[0].thickness).toFixed(3)} in; slide a spacer sleeve onto each rod between slabs.`:''}</span>}
    </div>}
  </div>;
}
