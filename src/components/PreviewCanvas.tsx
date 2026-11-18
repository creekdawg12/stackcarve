import { useEffect, useRef, type CSSProperties } from 'react';
import type { FrontPreview } from '../plan/preview';

/** Paints a rendered preview straight onto a canvas: no image encoding, so a grid of them stays quick. */
export function PreviewCanvas({ preview, label, className, style }: { preview: FrontPreview; label: string; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = preview.width; canvas.height = preview.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(preview.width, preview.height);
    image.data.set(preview.rgba);
    ctx.putImageData(image, 0, 0);
  }, [preview]);
  return <canvas ref={ref} className={className} style={style} role="img" aria-label={label}/>;
}
