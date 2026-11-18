import { maskFromAlpha } from '../relief/heightmap';
import { planSplit, type Box, type Pixels } from './split';
import type { Picture } from './types';

/** Long side, in pixels, of the copy that is analysed for background and subjects. */
const ANALYSIS = 512;
/** Long side of the copy that crops are taken from, and of each stored picture. */
const SOURCE = 2048, STORED = 1280;
/** The depth and cutout grid, matching relief/heightmap readPhoto. */
const GRID = 512;

let counter = 0;
export const newId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`;

/** The working grid a picture of this size gets: the same rule the photo loader uses. */
export function gridFor(width: number, height: number) {
  const scale = Math.min(1, GRID / Math.max(width, height));
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function toDataUrl(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return canvas.toDataURL(type, quality);
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Intake {
  pictures: Picture[];
  /** True when one pasted picture turned out to be a sheet of several designs. */
  split: boolean;
}

/**
 * Turn an incoming image into tray pictures. A sheet on a plain or transparent background comes
 * apart into one picture per design, each cropped to its subject and cut out; an ordinary photo
 * passes through whole, for the cutout tool to deal with later.
 */
export async function intake(blob: Blob, name: string): Promise<Intake> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, SOURCE / Math.max(bitmap.width, bitmap.height));
    const W = Math.max(2, Math.round(bitmap.width * scale)), H = Math.max(2, Math.round(bitmap.height * scale));
    const source = canvasOf(W, H);
    const sctx = source.getContext('2d')!;
    sctx.drawImage(bitmap, 0, 0, W, H);

    const aScale = Math.min(1, ANALYSIS / Math.max(W, H));
    const aw = Math.max(2, Math.round(W * aScale)), ah = Math.max(2, Math.round(H * aScale));
    const small = canvasOf(aw, ah);
    const actx = small.getContext('2d', { willReadFrequently: true })!;
    actx.drawImage(source, 0, 0, aw, ah);
    const pixels: Pixels = { width: aw, height: ah, data: actx.getImageData(0, 0, aw, ah).data };
    const plan = planSplit(pixels);
    const sheet = plan.parts.length > 1;
    const stem = name.replace(/\.[a-z0-9]+$/i, '') || 'picture';
    const addedAt = Date.now();

    const pictures = plan.parts.map((part, index): Picture => {
      const crop: Box = part.crop;
      // Crop in source pixels, snapped outward so the mask and the picture stay registered.
      const sx = Math.max(0, Math.floor(crop.x0 / aScale)), sy = Math.max(0, Math.floor(crop.y0 / aScale));
      const sw = Math.min(W - sx, Math.ceil((crop.x1 - crop.x0 + 1) / aScale)), sh = Math.min(H - sy, Math.ceil((crop.y1 - crop.y0 + 1) / aScale));
      const out = Math.min(1, STORED / Math.max(sw, sh));
      const cw = Math.max(2, Math.round(sw * out)), ch = Math.max(2, Math.round(sh * out));
      const canvas = canvasOf(cw, ch);
      const ctx = canvas.getContext('2d')!;
      // Transparent pictures are laid on white: the depth model and the photo pane both want an opaque image.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch);
      const grid = gridFor(cw, ch);
      const mask = part.mask ? maskFromAlpha(part.mask, crop.x1 - crop.x0 + 1, crop.y1 - crop.y0 + 1, grid.width, grid.height) : null;
      return {
        id: newId(),
        name: part.position ? titleCase(part.position.replace(/ \(.*\)$/, '')) : stem,
        position: part.position,
        dataUrl: toDataUrl(canvas, 'image/jpeg', 0.92),
        mimeType: 'image/jpeg',
        width: grid.width,
        height: grid.height,
        depth: null,
        mask,
        maskFrom: mask ? (plan.background.kind === 'alpha' ? 'transparent' : 'plain') : null,
        state: 'new',
        addedAt: addedAt + index
      };
    });
    return { pictures, split: sheet };
  } finally {
    bitmap.close?.();
  }
}

const QUARTERS = ['top left', 'top right', 'bottom left', 'bottom right'] as const;

/**
 * The fallback for a sheet the splitter could not take apart on its own (designs touching, a
 * frame drawn round them): cut it into four equal quarters and read each one as its own picture.
 */
export async function quarter(source: Blob): Promise<Picture[]> {
  const bitmap = await createImageBitmap(source);
  try {
    const w = Math.floor(bitmap.width / 2), h = Math.floor(bitmap.height / 2);
    const out: Picture[] = [];
    for (const [i, name] of QUARTERS.entries()) {
      const canvas = canvasOf(w, h);
      canvas.getContext('2d')!.drawImage(bitmap, (i % 2) * w, Math.floor(i / 2) * h, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not cut the picture')), 'image/png'));
      // A neighbour's edge may have come along; the design is whichever subject is biggest.
      const parts = (await intake(blob, name)).pictures;
      const size = (p: Picture) => p.mask ? p.mask.reduce((n, v) => n + (v ? 1 : 0), 0) * (p.width * p.height) / p.mask.length : p.width * p.height;
      const part = parts.reduce((best, p) => size(p) > size(best) ? p : best, parts[0]);
      out.push({ ...part, name: titleCase(name), position: name });
    }
    return out;
  } finally {
    bitmap.close?.();
  }
}
