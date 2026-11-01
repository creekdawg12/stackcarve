import type { SourceAsset, StackCarveProject, ProjectSettings, PipelineResult } from '../types';
import { DEFAULT_SETTINGS } from '../defaults';

export function makeProject(name: string, settings: ProjectSettings, sourceAsset: SourceAsset | null, result: PipelineResult | null): StackCarveProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    name,
    settings,
    sourceAsset,
    placements: result?.sheets.flatMap(s => s.placements) ?? [],
    createdAt: now,
    updatedAt: now
  };
}

/** Fill in any setting a project file predates, so files saved by older builds still open. */
export function mergeSettings(saved: Partial<ProjectSettings> | undefined): ProjectSettings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    wallArt: { ...DEFAULT_SETTINGS.wallArt, ...(s.wallArt ?? {}) },
    relief: { ...DEFAULT_SETTINGS.relief, ...(s.relief ?? {}) },
    ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai ?? {}) },
    rotationDeg: { ...DEFAULT_SETTINGS.rotationDeg, ...(s.rotationDeg ?? {}) }
  };
}

export function parseProject(text: string): StackCarveProject {
  const data = JSON.parse(text) as StackCarveProject;
  if (data.schemaVersion !== 1 || !data.settings) throw new Error('Unsupported StackCarve project file.');
  return { ...data, settings: mergeSettings(data.settings) };
}
