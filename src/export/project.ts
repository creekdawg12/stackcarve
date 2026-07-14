import type { SourceAsset, StackCarveProject, ProjectSettings, PipelineResult } from '../types';

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

export function parseProject(text: string): StackCarveProject {
  const data = JSON.parse(text) as StackCarveProject;
  if (data.schemaVersion !== 1 || !data.settings) throw new Error('Unsupported StackCarve project file.');
  return data;
}
