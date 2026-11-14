import type { MeshModel, PipelineResult, ProjectSettings, ReliefBase } from '../types';
import { composeHeightmap } from '../relief/heightmap';
import { resolveReliefSizing } from '../relief/sizing';
import { runPipeline } from './pipeline';

export interface BuildSource {
  settings: ProjectSettings;
  mesh: MeshModel | null;
  reliefBase: ReliefBase | null;
  mask: Uint8Array | null;
}

/** True when the chosen source (photo or 3D model) is loaded and ready to slice. */
export function sourceReady(s: Pick<BuildSource, 'settings' | 'mesh' | 'reliefBase'>) {
  return s.settings.inputMode === 'relief' ? !!s.reliefBase : !!s.mesh;
}

/**
 * One place that turns the project into cut geometry, so Generate, session restore and tests
 * all compose the photo depth and resolve its size the same way.
 */
export async function buildResult(source: BuildSource): Promise<PipelineResult> {
  const { settings, mesh, reliefBase, mask } = source;
  if (settings.inputMode === 'relief') {
    if (!reliefBase) throw new Error('Load a photo before generating slices.');
    const heightmap = composeHeightmap(reliefBase, { settings: settings.relief, mask, preview: false });
    return runPipeline({ settings: resolveReliefSizing(settings, heightmap), heightmap });
  }
  return runPipeline({ settings, mesh });
}

/** Pieces the build will be asked for before empty ends are dropped; cheap enough to run before every Generate. */
export function nominalCount(settings: ProjectSettings): number {
  const photo = settings.inputMode === 'relief';
  const mode = photo ? (settings.buildMode === 'slabs' ? 'slabs' : 'terraced') : settings.buildMode;
  const t = settings.materialThickness;
  if (mode === 'statue') return Math.max(1, Math.round(settings.targetHeight / t));
  if (mode === 'terraced') return Math.max(1, Math.round((photo ? settings.relief.depth : settings.wallArt.reliefDepth || settings.targetHeight) / t));
  const gap = Math.max(0, settings.wallArt.slabGap);
  // Slab direction changes which dimension is stacked; the larger of the two is a safe ceiling.
  const span = photo ? settings.relief.finishedWidth * 1.5 : settings.targetHeight;
  return Math.max(1, Math.round((span + gap) / (t + gap)));
}
