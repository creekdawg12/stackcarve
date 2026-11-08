import type { BuildMode, MeshModel, ProjectSettings, ReliefBase } from '../types';
import { measureOriented } from '../mesh/measure';

export interface BuildEstimate {
  /** Effective build mode (photo input never produces a statue). */
  mode: BuildMode;
  relief: boolean;
  wallArt: boolean;
  /** Piece count before the pipeline trims empty end layers. */
  count: number;
  /** True when the count is exact rather than an upper bound. */
  exact: boolean;
  /** Layer-to-layer spacing: stock thickness plus any slab gap. */
  pitch: number;
  thickness: number;
  /** Finished extent along the stacking axis. */
  stackExtent: number;
  /** Mesh size at the requested height, or null for photo input. */
  scaled: { width: number; depth: number } | null;
  /** Depth kept in front of the wall plane for mesh wall art. */
  keptDepth: number;
  /** Finished height of a photo relief at the chosen width. */
  reliefHeight: number;
}

/** Everything the panel and the Generate bar say about the build before it is generated. */
export function estimateBuild(settings: ProjectSettings, mesh: MeshModel | null, reliefBase: ReliefBase | null): BuildEstimate {
  const relief = settings.inputMode === 'relief';
  const mode: BuildMode = relief ? (settings.buildMode === 'slabs' ? 'slabs' : 'terraced') : settings.buildMode;
  const wallArt = mode !== 'statue';
  const t = settings.materialThickness;
  const gap = mode === 'slabs' ? Math.max(0, settings.wallArt.slabGap) : 0;
  const pitch = t + gap;

  let scaled: BuildEstimate['scaled'] = null;
  if (mesh && !relief) {
    const m = measureOriented(mesh.geometry, settings.rotationDeg);
    if (m.height > 0) {
      const k = settings.targetHeight / m.height;
      scaled = { width: m.width * k, depth: m.depth * k * (wallArt ? settings.wallArt.depthScale : 1) };
    }
  }
  const keptDepth = scaled ? (settings.wallArt.reliefDepth > 0 ? Math.min(settings.wallArt.reliefDepth, scaled.depth) : scaled.depth) : settings.wallArt.reliefDepth;
  const reliefHeight = reliefBase ? settings.relief.finishedWidth * (reliefBase.height - 1) / Math.max(1, reliefBase.width - 1) : settings.relief.finishedWidth;

  const span = mode === 'slabs'
    ? (relief
      ? (settings.wallArt.slabDirection === 'horizontal' ? reliefHeight : settings.relief.finishedWidth)
      : (settings.wallArt.slabDirection === 'horizontal' ? settings.targetHeight : (scaled?.width ?? settings.targetHeight)))
    : (mode === 'terraced' ? (relief ? settings.relief.depth : keptDepth) : settings.targetHeight);
  const count = Math.max(1, Math.round((span + gap) / pitch));

  return {
    mode, relief, wallArt, count, exact: mode === 'statue', pitch, thickness: t,
    stackExtent: count * pitch - gap, scaled, keptDepth, reliefHeight
  };
}
