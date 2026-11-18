import type { ProjectSettings } from '../types';
import type { ResolvedField } from './plan';

export interface SlabCut {
  /** Front edge of the slab above the wall plane, in inches, sampled along its length. 0 = no slab there. */
  profile: Float32Array;
  /** Distance of the slab's first face from where the stack starts, in inches. */
  at: number;
  /** First and last grid line (column or row) this slab stands for, gap included. */
  hold0: number;
  hold1: number;
}

export interface SlabStack {
  slabs: SlabCut[];
  /** True when slabs run up and down and stack left to right. */
  vertical: boolean;
  /** Grid lines across the stack, and samples along each slab. */
  lines: number;
  samples: number;
  pitch: number;
}

/**
 * Every slab's front edge, read off the field the way the slicer reads a photo: the closest point
 * anywhere in the slab's band wins. Shared by the previews and the carve checks so they agree.
 */
export function slabStack(settings: ProjectSettings, r: ResolvedField): SlabStack {
  const t = settings.materialThickness;
  const gap = Math.max(0, settings.wallArt.slabGap);
  const pitch = t + gap;
  const vertical = settings.wallArt.slabDirection === 'vertical';
  const lines = vertical ? r.cols : r.rows, samples = vertical ? r.rows : r.cols;
  const span = lines * r.cell;
  const n = Math.max(1, Math.round((span + gap) / pitch));
  const slabs: SlabCut[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = Math.floor((i * pitch) / r.cell);
    if (a0 >= lines) break;
    const a1 = Math.min(lines - 1, Math.max(a0, Math.ceil(Math.min(span, i * pitch + t) / r.cell) - 1));
    const profile = new Float32Array(samples);
    for (let a = a0; a <= a1; a++) {
      // Vertical slabs count columns from the viewer's left; horizontal slabs count rows from the bottom.
      const line = vertical ? a : r.rows - 1 - a;
      for (let s = 0; s < samples; s++) {
        const k = vertical ? s * r.cols + line : line * r.cols + s;
        if (r.inside[k] && r.front[k] > profile[s]) profile[s] = r.front[k];
      }
    }
    const hold1 = Math.min(lines - 1, Math.max(a1, Math.floor(((i + 1) * pitch) / r.cell) - 1));
    slabs.push({ profile, at: i * pitch, hold0: a0, hold1 });
  }
  return { slabs, vertical, lines, samples, pitch };
}
