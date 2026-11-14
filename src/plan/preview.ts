import type { MaterialId, ProjectSettings } from '../types';
import type { FrontField } from './field';
import { resolveField, type ResolvedField } from './plan';

/** Sheet-good colours for the preview, as [r, g, b]. */
const WOOD: Record<MaterialId, [number, number, number]> = {
  mdf: [196, 160, 112],
  birch: [222, 197, 152],
  plywood: [210, 176, 122],
  hardboard: [146, 108, 74]
};

export interface FrontPreview {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Size of the drawn piece in inches. */
  widthIn: number;
  heightIn: number;
}

interface Box { x0: number; x1: number; y0: number; y1: number }

function boxOf(r: ResolvedField): Box | null {
  let x0 = r.cols, x1 = -1, y0 = r.rows, y1 = -1;
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
    if (!r.inside[y * r.cols + x]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < x0 ? null : { x0, x1, y0, y1 };
}

/**
 * What the finished piece will look like from the front at the current stock, gap and
 * direction: slabs drawn as lit strips with the wall showing through the gaps, terraces as
 * stepped contour bands. Pure pixels, so it runs the same in tests and in the browser.
 */
export function renderFrontPreview(settings: ProjectSettings, field: FrontField, maxPx = 620): FrontPreview | null {
  const r = resolveField(settings, field);
  const box = boxOf(r);
  if (!box) return null;
  const cols = box.x1 - box.x0 + 1, rows = box.y1 - box.y0 + 1;
  const ppc = Math.max(1, Math.min(4, maxPx / Math.max(cols, rows)));
  const width = Math.max(1, Math.round(cols * ppc)), height = Math.max(1, Math.round(rows * ppc));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const wood = WOOD[settings.plan.material] ?? WOOD.mdf;
  const t = settings.materialThickness;
  const gap = r.mode === 'slabs' ? Math.max(0, settings.wallArt.slabGap) : 0;
  const pitch = t + gap;
  const vertical = settings.wallArt.slabDirection === 'vertical';
  const keep = Math.max(1e-6, r.keep);
  const backer = r.mode === 'slabs' && settings.wallArt.backerPlate;
  // Distance from the bottom edge is measured the way the slicer measures it.
  const bottomLine = r.photo ? r.rows : field.span.height;
  const layers = Math.max(1, Math.round(keep / t));
  const offset = keep - layers * t;

  const at = (cx: number, cy: number) => {
    const x = Math.floor(cx), y = Math.floor(cy);
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return -1;
    const k = y * r.cols + x;
    return r.inside[k] ? r.front[k] - (r.back && r.mode === 'slabs' ? r.back[k] : 0) : -1;
  };
  const level = (h: number) => r.photo
    ? (layers > 1 ? Math.min(layers - 1, Math.floor(h * (layers - 1) / keep + 1e-9)) : 0)
    : Math.min(layers - 1, Math.ceil((h - offset) / t - 0.5) - 1);
  const put = (i: number, shade: number, alpha = 255) => {
    rgba[i] = wood[0] * shade; rgba[i + 1] = wood[1] * shade; rgba[i + 2] = wood[2] * shade; rgba[i + 3] = alpha;
  };

  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const cx = box.x0 + (px + 0.5) / ppc, cy = box.y0 + (py + 0.5) / ppc;
    const i = (py * width + px) * 4;
    if (r.mode === 'slabs') {
      // Position along the stacking direction, in inches from where the slicer starts counting.
      const along = vertical ? cx * r.cell : (bottomLine - cy) * r.cell;
      const index = Math.floor(along / pitch);
      const into = along - index * pitch;
      const centre = (index * pitch + t / 2) / r.cell;
      const sx = vertical ? centre : cx, sy = vertical ? cy : bottomLine - centre;
      const h = into < t ? at(sx, sy) : -1;
      if (h > 0) {
        // Light from above and from the viewer's left: a profile rising toward the light is brighter.
        const before = vertical ? at(sx, sy - 1) : at(sx - 1, sy), after = vertical ? at(sx, sy + 1) : at(sx + 1, sy);
        const slope = before > 0 && after > 0 ? (after - before) / (2 * r.cell) : 0;
        let shade = 0.54 + 0.48 * (h / keep) + Math.max(-0.24, Math.min(0.24, slope * 0.45));
        const f = into / t;
        if (gap > 0 || t / r.cell * ppc >= 3) { if (f > 0.8) shade *= 0.78; else if (f < 0.14) shade *= 1.07; }
        put(i, Math.min(1.12, shade));
      } else if (backer && at(cx, cy) > 0) {
        put(i, 0.46);
      }
      continue;
    }
    const h = at(cx, cy);
    if (h <= 0) continue;
    if (r.mode === 'terraced') {
      const here = level(h);
      if (here < 0) continue;
      // A higher step up and to the left throws a shadow; a lower one there means this edge catches the light.
      const upLeft = at(cx - 0.7, cy - 0.7);
      const there = upLeft > 0 ? level(upLeft) : -1;
      let shade = 0.6 + 0.42 * (layers > 1 ? here / (layers - 1) : 1);
      if (there > here) shade *= 0.7; else if (there < here) shade *= 1.1;
      put(i, Math.min(1.12, shade));
      continue;
    }
    // Statue: stacked layers read as fine horizontal grooves.
    const up = (bottomLine - cy) * r.cell;
    const into = up - Math.floor(up / t) * t;
    let shade = 0.62 + 0.4 * (h / keep);
    if (into < Math.max(t * 0.14, r.cell / ppc)) shade *= 0.74;
    put(i, Math.min(1.12, shade));
  }
  return { width, height, rgba, widthIn: cols * r.cell, heightIn: rows * r.cell };
}

export interface SectionBand {
  /** Inches from the top of the piece. */
  top: number;
  bottom: number;
  /** How far this band stands off the wall, inches. */
  depth: number;
}

/** Side view: how far the piece stands off the wall at each height, cut the way the style cuts it. */
export function sectionProfile(settings: ProjectSettings, field: FrontField): { heightIn: number; depthIn: number; bands: SectionBand[] } | null {
  const r = resolveField(settings, field);
  const box = boxOf(r);
  if (!box || r.mode === 'statue') return null;
  const rows = box.y1 - box.y0 + 1;
  const t = settings.materialThickness;
  const keep = Math.max(1e-6, r.keep);
  const profile = new Float32Array(rows);
  for (let y = box.y0; y <= box.y1; y++) {
    let best = 0;
    for (let x = box.x0; x <= box.x1; x++) { const k = y * r.cols + x; if (r.inside[k] && r.front[k] > best) best = r.front[k]; }
    profile[y - box.y0] = best;
  }
  const bands: SectionBand[] = [];
  if (r.mode === 'slabs' && settings.wallArt.slabDirection === 'horizontal') {
    const gap = Math.max(0, settings.wallArt.slabGap), pitch = t + gap;
    const bottomLine = r.photo ? r.rows : field.span.height;
    // One rectangle per slab, counted from the bottom like the slicer does.
    for (let i = 0; ; i++) {
      const lowIn = i * pitch, highIn = lowIn + t;
      const yBottom = bottomLine - lowIn / r.cell, yTop = bottomLine - highIn / r.cell;
      if (yBottom < box.y0) break;
      if (yTop > box.y1 + 1) continue;
      let best = 0;
      for (let y = Math.max(box.y0, Math.floor(yTop)); y <= Math.min(box.y1, Math.ceil(yBottom) - 1); y++) best = Math.max(best, profile[y - box.y0]);
      if (best > 0) bands.push({ top: Math.max(0, (yTop - box.y0) * r.cell), bottom: Math.min(rows * r.cell, (yBottom - box.y0) * r.cell), depth: best });
      if (i > 2000) break;
    }
  } else {
    const layers = Math.max(1, Math.round(keep / t));
    for (let y = 0; y < rows; y++) {
      let d = profile[y];
      if (d <= 0) continue;
      // Terraces come in whole layers; vertical slabs keep their smooth profile.
      if (r.mode === 'terraced') d = (r.photo ? (layers > 1 ? Math.min(layers - 1, Math.floor(d * (layers - 1) / keep + 1e-9)) : 0) + 1 : Math.max(1, Math.round(d / t))) * t;
      bands.push({ top: y * r.cell, bottom: (y + 1) * r.cell, depth: d });
    }
  }
  const depthIn = bands.reduce((m, b) => Math.max(m, b.depth), 0);
  return { heightIn: rows * r.cell, depthIn, bands };
}
