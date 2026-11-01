import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { composeHeightmap } from '../relief/heightmap';

type Brush = 'keep' | 'remove';

/**
 * Photo tab: the photo with the cutout mask painted over it on the left, the composed depth
 * (what the slicer will cut) on the right. Paint with the brush to fix the mask edges.
 */
export function PhotoWorkbench() {
  const { sourceAsset, reliefBase, mask, settings, dispatch } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const workingMask = useRef<Uint8Array | null>(null);
  const [brush, setBrush] = useState<Brush>('remove');
  const [radius, setRadius] = useState(18);
  const [showMask, setShowMask] = useState(true);
  const [tick, setTick] = useState(0);

  const base = reliefBase;
  const composed = useMemo(() => base ? composeHeightmap(base, { settings: settings.relief, mask }) : null, [base, mask, settings.relief]);

  useEffect(() => {
    if (!sourceAsset?.dataUrl) { photoRef.current = null; return; }
    const img = new Image();
    img.onload = () => { photoRef.current = img; setTick(t => t + 1); };
    img.src = sourceAsset.dataUrl;
  }, [sourceAsset?.dataUrl]);

  useEffect(() => { workingMask.current = mask ? new Uint8Array(mask) : null; setTick(t => t + 1); }, [mask]);

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

  const toPixel = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height, scale: canvas.width / r.width };
  };

  const paint = (px: number, py: number, scale: number) => {
    if (!workingMask.current) {
      // Start from the threshold silhouette so the first stroke edits something sensible.
      const m = new Uint8Array(base.width * base.height);
      for (let i = 0; i < m.length; i++) m[i] = base.values[i] >= settings.relief.backgroundThreshold ? 255 : 0;
      workingMask.current = m;
    }
    const m = workingMask.current;
    const rr = radius * scale;
    const value = brush === 'keep' ? 255 : 0;
    const x0 = Math.max(0, Math.floor(px - rr)), x1 = Math.min(base.width - 1, Math.ceil(px + rr));
    const y0 = Math.max(0, Math.floor(py - rr)), y1 = Math.min(base.height - 1, Math.ceil(py + rr));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - px) ** 2 + (y - py) ** 2 <= rr * rr) m[y * base.width + x] = value;
    }
  };

  let painting = false;
  const down = (e: React.PointerEvent) => { painting = true; (e.target as Element).setPointerCapture(e.pointerId); const p = toPixel(e); paint(p.x, p.y, p.scale); setTick(t => t + 1); };
  const move = (e: React.PointerEvent) => { if (!painting && e.buttons !== 1) return; const p = toPixel(e); paint(p.x, p.y, p.scale); setTick(t => t + 1); };
  const up = () => { painting = false; if (workingMask.current) dispatch({ type: 'mask', mask: new Uint8Array(workingMask.current) }); };

  const stats = (() => {
    if (!composed) return '';
    let inside = 0;
    for (let i = 0; i < composed.values.length; i++) if (composed.values[i] >= settings.relief.backgroundThreshold) inside++;
    return `${((inside / composed.values.length) * 100).toFixed(0)}% of the frame is kept`;
  })();

  return <div className="photo-bench" ref={wrapRef}>
    <div className="photo-tools">
      <div className="segmented small"><button className={brush === 'remove' ? 'active' : ''} onClick={() => setBrush('remove')}>Remove</button><button className={brush === 'keep' ? 'active' : ''} onClick={() => setBrush('keep')}>Keep</button></div>
      <label className="inline"><span>Brush</span><input type="range" min="3" max="80" value={radius} onChange={e => setRadius(Number(e.target.value))}/><b>{radius}px</b></label>
      <label className="toggle inline"><input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)}/><span>Show removed areas</span></label>
      <span className="muted">{base.source === 'depth' ? 'AI depth' : 'Brightness'} · {base.width} × {base.height} · {stats}</span>
    </div>
    <div className="photo-panes">
      <figure>
        <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={e => { if (e.buttons === 1) up(); }} style={{ cursor: 'crosshair', touchAction: 'none' }}/>
        <figcaption>Photo and mask. Paint red over anything that should not be part of the piece.</figcaption>
      </figure>
      <figure>
        {composed && <img src={composed.previewUrl} alt="Depth that will be cut"/>}
        <figcaption>Depth to cut: white is closest to you, black is at the wall, blue is removed.</figcaption>
      </figure>
    </div>
  </div>;
}
