import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { centroid, circlePolyline, transformPolyline } from '../geometry/polygon';
import { sheetToDxf } from '../export/dxf';
import { sheetToSvg } from '../export/svg';
import { downloadBlob } from '../utils/files';
import { exportAll } from '../export/bundle';
import { EmptyStage } from './EmptyStage';

function d(points: {x:number;y:number}[], closed = true) {
  return points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + (closed?' Z':'');
}

export function SheetsView() {
  const { result, settings, sourceAsset, selectedPartId, stale, projectName, dispatch } = useStore();
  const [page, setPage] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => result?.layers.flatMap(l => l.parts) ?? [], [result]);
  const sheetCount = result?.sheets.length ?? 0;
  const index = sheetCount ? Math.min(page, sheetCount - 1) : 0;
  const sheet = sheetCount ? result!.sheets[index] : null;
  // Hooks must run on every render, including the empty state below.
  const view = usePanZoom(stageRef, sheet?.width ?? 48, sheet?.height ?? 48);
  if (!result || !sheet) return <EmptyStage title="No sheets yet">Generating nests every part onto your sheets and makes the cut files.</EmptyStage>;
  const exportSheet = (kind: 'dxf'|'svg') => {
    const text = kind === 'dxf' ? sheetToDxf(sheet, parts, settings) : sheetToSvg(sheet, parts, settings);
    downloadBlob(new Blob([text], { type: kind === 'dxf' ? 'application/dxf' : 'image/svg+xml' }), `${projectName || 'stackcarve'}_sheet_${String(index+1).padStart(2,'0')}.${kind}`);
  };
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return <div className="sheets-view">
    <div className="sheet-toolbar">
      <div className="pager"><button onClick={()=>{setPage(Math.max(0,index-1));view.reset();}} disabled={index===0} aria-label="Previous sheet">←</button><b>Sheet {index+1} of {result.sheets.length}</b><button onClick={()=>{setPage(Math.min(result.sheets.length-1,index+1));view.reset();}} disabled={index===result.sheets.length-1} aria-label="Next sheet">→</button></div>
      <ExportMenu disabled={stale} sheetNumber={index+1} onZip={()=>exportAll(projectName,result,settings,sourceAsset)} onDxf={()=>exportSheet('dxf')} onSvg={()=>exportSheet('svg')}/>
    </div>
    <div className="sheet-stage" ref={stageRef} onPointerDown={view.onPointerDown} onPointerMove={view.onPointerMove} onPointerUp={view.onPointerUp} onPointerCancel={view.onPointerUp} onWheel={view.onWheel} style={{touchAction:'none',cursor:view.dragging?'grabbing':'grab'}}>
      <div className="view-buttons" onPointerDown={e=>e.stopPropagation()}><button onClick={()=>view.zoomBy(1.25)} aria-label="Zoom in">+</button><button onClick={()=>view.zoomBy(0.8)} aria-label="Zoom out">−</button><button onClick={()=>view.reset()} aria-label="Fit the sheet">Fit</button></div>
      <svg viewBox={view.viewBox(sheet.width, sheet.height)} aria-label={`Sheet ${index+1}`}>
        <rect x="0" y="0" width={sheet.width} height={sheet.height} className="sheet-outline"/>
        <g transform={`translate(0 ${sheet.height}) scale(1 -1)`}>
          {sheet.placements.map(pl => {
            const part = parts.find(p=>p.id===pl.partId)!;
            const t=(poly:{x:number;y:number}[])=>transformPolyline(poly,pl.x,pl.y,pl.rotation);
            return <g key={pl.partId} className={part.id===selectedPartId?'part selected':'part'} onClick={()=>{ if(!view.dragging) dispatch({type:'selectPart',id:part.id}); }}>
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
    <div className="sheet-stats"><span>{plural(sheet.placements.length,'part')} on this sheet</span><span>{(sheet.utilization*100).toFixed(0)}% of it used</span><span>Red cuts out, blue cuts inside, green drills, purple etches</span></div>
  </div>;
}

/** One Export button with a menu: the ZIP bundle is the normal path; single-sheet DXF and SVG for quick checks. */
function ExportMenu({ disabled, sheetNumber, onZip, onDxf, onSvg }: { disabled: boolean; sheetNumber: number; onZip: () => void; onDxf: () => void; onSvg: () => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const run = (fn: () => void) => { setOpen(false); fn(); };
  return <div className="export-menu" ref={host}>
    <button type="button" className="btn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} title={disabled ? 'Regenerate before exporting' : undefined}>Export</button>
    {open && <div className="menu" role="menu">
      {disabled && <div className="menu-note">Settings changed. Regenerate before exporting.</div>}
      <button role="menuitem" disabled={disabled} onClick={() => run(onZip)}><b>Everything, as a ZIP</b><small>All sheets as DXF and SVG, plus the checklist</small></button>
      <button role="menuitem" disabled={disabled} onClick={() => run(onDxf)}><b>Sheet {sheetNumber} as DXF</b><small>Layers: OUTER_CUT, INNER_CUT, DOWEL, ETCH</small></button>
      <button role="menuitem" disabled={disabled} onClick={() => run(onSvg)}><b>Sheet {sheetNumber} as SVG</b><small>For a quick look or a laser</small></button>
    </div>}
  </div>;
}

/** Pan and zoom for the sheet drawing: drag or one finger to pan, pinch or wheel to zoom, buttons for the rest. */
function usePanZoom(stageRef: React.RefObject<HTMLDivElement | null>, width: number, height: number) {
  const [state, setState] = useState({ scale: 1, cx: 0.5, cy: 0.5 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; dist: number } | null>(null);
  const pad = 0.04;

  const viewBox = (w: number, h: number) => {
    const vw = (w * (1 + 2 * pad)) / state.scale, vh = (h * (1 + 2 * pad)) / state.scale;
    const x = state.cx * w - vw / 2, y = state.cy * h - vh / 2;
    return `${x.toFixed(4)} ${y.toFixed(4)} ${vw.toFixed(4)} ${vh.toFixed(4)}`;
  };
  const clampScale = (s: number) => Math.min(12, Math.max(1, s));
  const zoomBy = (f: number) => setState(st => ({ ...st, scale: clampScale(st.scale * f) }));
  const reset = () => setState({ scale: 1, cx: 0.5, cy: 0.5 });
  /** Pixels on screen per sheet inch, for turning pointer motion into pan. */
  const pxPerIn = () => {
    const el = stageRef.current; if (!el) return 1;
    const r = el.getBoundingClientRect();
    const vw = (width * (1 + 2 * pad)) / state.scale, vh = (height * (1 + 2 * pad)) / state.scale;
    return Math.min(r.width / vw, r.height / vh);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    last.current = pts.length >= 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) } : { x: e.clientX, y: e.clientY, dist: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const k = pxPerIn();
    if (pts.length >= 2) {
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const prev = last.current!;
      setState(st => ({ scale: clampScale(prev.dist ? st.scale * (dist / prev.dist) : st.scale), cx: st.cx - (mid.x - prev.x) / k / width, cy: st.cy - (mid.y - prev.y) / k / height }));
      last.current = { ...mid, dist };
    } else {
      const prev = last.current!;
      setState(st => ({ ...st, cx: st.cx - (e.clientX - prev.x) / k / width, cy: st.cy - (e.clientY - prev.y) / k / height }));
      last.current = { x: e.clientX, y: e.clientY, dist: 0 };
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const pts = [...pointers.current.values()];
    last.current = pts.length ? { x: pts[0].x, y: pts[0].y, dist: 0 } : null;
    if (!pts.length) setDragging(false);
  };
  const onWheel = (e: React.WheelEvent) => { zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  return { viewBox, zoomBy, reset, dragging, onPointerDown, onPointerMove, onPointerUp, onWheel };
}
