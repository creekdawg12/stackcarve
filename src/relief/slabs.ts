import type { Polyline, SlabDirection } from '../types';
import { simplifyRdp } from '../geometry/polygon';
import { regionsFromLoops, type SectionRegion } from '../mesh/slice';
import type { HeightmapData } from './heightmap';

export interface HeightmapSlabOptions {
  finishedWidth: number;
  /** Depth of the closest point off the wall, in inches. */
  reliefDepth: number;
  /** Minimum depth inside the silhouette, in inches. */
  baseDepth: number;
  thickness: number;
  gap: number;
  direction: SlabDirection;
  backgroundThreshold: number;
  simplifyTolerance: number;
  minFeature: number;
  /** Runs whose cut area is below this are dropped, in square inches. */
  minIslandArea?: number;
}

export interface HeightmapSlabs {
  sections: SectionRegion[][];
  /** Drawing y of the flat back edge (always 0 here). */
  backY: number;
  finishedHeight: number;
  /** Total extent along the stacking direction, gaps included. */
  stackExtent: number;
  pitch: number;
}

/**
 * Cut a photo heightmap into slabs. Each slab's outline is the depth profile along a band of the
 * image (rows for horizontal slabs, columns for vertical), closed along the flat back at y = 0.
 *
 * Drawing frame, matching the mesh slab convention (top face up on the machine, next slab covers it):
 *   horizontal: x = across the wall with the viewer's right at -x, y = depth off the wall
 *   vertical:   x = up the wall, y = depth off the wall
 */
export function slabsFromHeightmap(map: HeightmapData, o: HeightmapSlabOptions): HeightmapSlabs {
  const { width, height, values } = map;
  const sx = o.finishedWidth / Math.max(1, width - 1);
  const finishedHeight = (height - 1) * sx;
  const pitch = o.thickness + Math.max(0, o.gap);
  const stackSpan = o.direction === 'horizontal' ? finishedHeight : o.finishedWidth;
  const count = Math.max(1, Math.round((stackSpan + Math.max(0, o.gap)) / pitch));
  const depthSpan = Math.max(0, o.reliefDepth - o.baseDepth);
  const inside = (v: number) => v >= o.backgroundThreshold;
  const depthOf = (v: number) => o.baseDepth + Math.max(0, Math.min(1, (v - o.backgroundThreshold) / Math.max(1e-6, 1 - o.backgroundThreshold))) * depthSpan;

  const sections: SectionRegion[][] = [];
  for (let i = 0; i < count; i++) {
    const bandStart = i * pitch;
    const bandEnd = Math.min(stackSpan, bandStart + o.thickness);
    // Pixel band covered by this slab along the stacking axis.
    let b0: number, b1: number;
    if (o.direction === 'horizontal') {
      // Image row 0 is the top of the wall; slabs count from the bottom.
      b0 = Math.max(0, Math.floor((height - 1) - bandEnd / sx));
      b1 = Math.min(height - 1, Math.ceil((height - 1) - bandStart / sx));
    } else {
      b0 = Math.max(0, Math.floor(bandStart / sx));
      b1 = Math.min(width - 1, Math.ceil(bandEnd / sx));
    }
    if (b1 < b0) { sections.push([]); continue; }

    const samples = o.direction === 'horizontal' ? width : height;
    const profile = new Float32Array(samples);
    const present = new Uint8Array(samples);
    for (let s = 0; s < samples; s++) {
      let best = -1;
      for (let b = b0; b <= b1; b++) {
        const v = o.direction === 'horizontal' ? values[b * width + s] : values[s * width + b];
        if (inside(v) && v > best) best = v;
      }
      if (best >= 0) { present[s] = 1; profile[s] = depthOf(best); }
    }
    // Bridge short breaks (mask noise) and drop specks so a slab is a few solid runs, not confetti.
    const bridgeSamples = Math.max(1, Math.round(Math.max(o.minFeature * 2, 0.5) / sx));
    const minRunSamples = Math.max(1, Math.round(o.minFeature / sx));
    for (let s = 0; s < samples; s++) {
      if (present[s]) continue;
      let e = s;
      while (e < samples && !present[e]) e++;
      const gapLen = e - s;
      if (s > 0 && e < samples && gapLen <= bridgeSamples) {
        for (let k = s; k < e; k++) { present[k] = 1; profile[k] = o.baseDepth; }
      }
      s = e;
    }
    for (let s = 0; s < samples; s++) {
      if (!present[s]) continue;
      let e = s;
      while (e < samples && present[e]) e++;
      if (e - s < minRunSamples) for (let k = s; k < e; k++) present[k] = 0;
      s = e;
    }
    // Drawing x for sample s.
    const xAt = (s: number) => o.direction === 'horizontal'
      ? o.finishedWidth / 2 - s * sx          // mirror: viewer's right is -x
      : (height - 1 - s) * sx;                // up the wall

    const loops: Polyline[] = [];
    let s = 0;
    while (s < samples) {
      if (!present[s]) { s++; continue; }
      const start = s;
      while (s < samples && present[s]) s++;
      const end = s - 1;
      const run = end - start + 1;
      if (run * sx < o.minFeature) continue;
      let runArea = 0;
      for (let k = start; k <= end; k++) runArea += profile[k] * sx;
      if (runArea < (o.minIslandArea ?? 0)) continue;
      const half = sx / 2;
      const xs = xAt(start) + (o.direction === 'horizontal' ? half : -half);
      const xe = xAt(end) + (o.direction === 'horizontal' ? -half : half);
      const front: Polyline = [];
      for (let k = start; k <= end; k++) front.push({ x: xAt(k), y: profile[k] });
      const outline: Polyline = [{ x: xs, y: 0 }, { x: xs, y: profile[start] }, ...simplifyRdp(front, o.simplifyTolerance), { x: xe, y: profile[end] }, { x: xe, y: 0 }];
      loops.push(dedupe(outline));
    }
    sections.push(regionsFromLoops(loops));
  }
  return { sections, backY: 0, finishedHeight, stackExtent: count * pitch - Math.max(0, o.gap), pitch };
}

function dedupe(poly: Polyline): Polyline {
  const out: Polyline = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
  }
  return out;
}
