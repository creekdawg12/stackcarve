import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { composeHeightmap, fillHoles, keepLargestRegion, maskFromThreshold } from '../relief/heightmap';

type Brush = 'keep' | 'remove';
const UNDO_LIMIT = 25;

/**
 * Photo tab: the photo with the cutout mask painted over it on the left, the composed depth
 * (what the slicer will cut) on the right. Paint with the brush to fix the mask edges; cleanup
 * buttons keep the largest region or fill enclosed holes; Undo steps back through all of it.
 */
export function PhotoWorkbench() {
  const { sourceAsset, reliefBase, mask, settings, dispatch } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const workingMask = useRef<Uint8Array | null>(null);
  const undoStack = useRef<(Uint8Array | null)[]>([]);
  const painting = useRef(false);
  const [brush, setBrush] = useState<Brush>('remove');
  const [radius, setRadius] = useState(18);
  const [showMask, setShowMask] = useState(true);
  const [tick, setTick] = useState(0);
  const [undoDepth, setUndoDepth] = useState(0);

  const base = reliefBase;
  const composed = useMemo(() => base ? composeHeightmap(base, { settings: settings.relief, mask }) : null, [base, mask, settings.relief]);

  useEffect(() => {
    if (!sourceAsset?.dataUrl) { photoRef.current = null; return; }
    const img = new Image();
    img.onload = () => { photoRef.current = img; setTick(t => t + 1); };
    img.src = sourceAsset.dataUrl;
  }, [sourceAsset?.dataUrl]);

  useEffect(() => { workingMask.current = mask ? new Uint8Array(mask) : null; setTick(t => t + 1); }, [mask]);
  // A new photo starts a fresh history.
  useEffect(() => { undoStack.current = []; setUndoDepth(0); }, [base]);

  // Draw photo plus mask overlay.
  useEffect(() => {
    const canvas = canvasRef.current, img = photoRef.current;
    if (!canvas || !base) return;
    canvas.width = base.width; canvas.height = base.height;
    const ctx = canvas.getContext('2d')!;
    if (img) ctx.drawImage(img, 0, 0, base.width, base.height);
    else { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, base.width, base.height); }
    const m = workingMask.current;
    if (showMask) {
      const overlay = ctx.getImageData(0, 0, base.width, base.height);
      for (let i = 0; i < base.width * base.height; i++) {
        const out = m ? m[i] === 0 : base.values[i] < settings.relief.backgroundThreshold;
        if (!out) continue;
        overlay.data[i * 4] = Math.round(overlay.data[i * 4] * 0.35 + 200 * 0.65);
        overlay.data[i * 4 + 1] = Math.round(overlay.data[i * 4 + 1] * 0.35 + 40 * 0.65);
        overlay.data[i * 4 + 2] = Math.round(overlay.data[i * 4 + 2] * 0.35 + 60 * 0.65);
      }
      ctx.putImageData(overlay, 0, 0);
    }
  }, [base, showMask, tick, settings.relief.backgroundThreshold]);

  if (!base) {
    return <div className="viewport empty-state"><strong>Photo workbench</strong><span>Load a photo in the panel, then estimate depth and cut out the subject here.</span></div>;
  }

  const pushUndo = () => {
    undoStack.current.push(mask ? new Uint8Array(mask) : null);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setUndoDepth(undoStack.current.length);
  };
  const commit = (m: Uint8Array | null) => dispatch({ type: 'mask', mask: m });
  const undo = () => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop()!;
    setUndoDepth(undoStack.current.length);
    dispatch({ type: 'mask', mask: prev });
  };
  const currentMask = () => mask ?? maskFromThreshold(base, settings.relief.backgroundThreshold);
  const keepLargest = () => { pushUndo(); commit(keepLargestRegion(currentMask(), base.width, base.height)); };
  const fill = () => { pushUndo(); commit(fillHoles(currentMask(), base.width, base.height)); };
  const invert = () => { pushUndo(); const m = currentMask(); const out = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) out[i] = m[i] ? 0 : 255; commit(out); };

  const toPixel = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height, scale: canvas.width / r.width };
  };

  const paint = (px: number, py: number, scale: number) => {
    if (!workingMask.current) workingMask.current = maskFromThreshold(base, settings.relief.backgroundThreshold);
    const m = workingMask.current;
    const rr = radius * scale;
    const value = brush === 'keep' ? 255 : 0;
    const x0 = Math.max(0, Math.floor(px - rr)), x1 = Math.min(base.width - 1, Math.ceil(px + rr));
    const y0 = Math.max(0, Math.floor(py - rr)), y1 = Math.min(base.height - 1, Math.ceil(py + rr));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - px) ** 2 + (y - py) ** 2 <= rr * rr) m[y * base.width + x] = value;
    }
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    painting.current = true;
    pushUndo();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toPixel(e); paint(p.x, p.y, p.scale); setTick(t => t + 1);
  };
  const move = (e: React.PointerEvent) => { if (!painting.current) return; const p = toPixel(e); paint(p.x, p.y, p.scale); setTick(t => t + 1); };
  const up = () => { if (!painting.current) return; painting.current = false; if (workingMask.current) commit(new Uint8Array(workingMask.current)); };

  const stats = (() => {
    if (!composed) return '';
    let inside = 0;
    for (let i = 0; i < composed.values.length; i++) if (composed.values[i] >= settings.relief.backgroundThreshold) inside++;
    return `${((inside / composed.values.length) * 100).toFixed(0)}% of the frame is kept`;
  })();

  return <div className="photo-bench">
    <div className="photo-tools">
      <div className="segmented small"><button className={brush === 'remove' ? 'active' : ''} onClick={() => setBrush('remove')}>Remove</button><button className={brush === 'keep' ? 'active' : ''} onClick={() => setBrush('keep')}>Keep</button></div>
      <label className="inline"><span>Brush</span><input type="range" min="3" max="80" value={radius} onChange={e => setRadius(Number(e.target.value))}/><b>{radius}px</b></label>
      <div className="btn-row compact">
        <button onClick={undo} disabled={!undoDepth} title="Undo the last stroke or cleanup">Undo{undoDepth ? ` (${undoDepth})` : ''}</button>
        <button onClick={keepLargest} title="Keep only the biggest connected area and drop specks">Keep largest</button>
        <button onClick={fill} title="Fill background pockets enclosed by the subject">Fill holes</button>
        <button onClick={invert} title="Swap kept and removed">Invert</button>
      </div>
      <label className="toggle inline"><input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)}/><span>Show removed areas</span></label>
      <span className="muted">{base.source === 'depth' ? 'AI depth' : 'Brightness'} · {base.width} × {base.height} · {stats}</span>
    </div>
    <div className="photo-panes">
      <figure>
        <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} style={{ cursor: 'crosshair', touchAction: 'none' }}/>
        <figcaption>Photo and mask. Paint red over anything that should not be part of the piece. Keep largest drops specks; Fill holes closes eyes and gaps.</figcaption>
      </figure>
      <figure>
        {composed && <img src={composed.previewUrl} alt="Depth that will be cut"/>}
        <figcaption>Depth to cut: white is closest to you, black is at the wall, blue is removed.</figcaption>
      </figure>
    </div>
  </div>;
}
