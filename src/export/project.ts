import type { SourceAsset, StackCarveProject, ProjectSettings, PipelineResult, ReliefBase, StoredRelief } from '../types';
import { DEFAULT_SETTINGS } from '../defaults';

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Pack the photo depth (quantised to 8 bits) and the mask so a saved project reopens without rerunning the models. */
export function encodeRelief(base: ReliefBase | null, mask: Uint8Array | null): StoredRelief | undefined {
  if (!base) return undefined;
  const q = new Uint8Array(base.values.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(0, Math.min(255, Math.round(base.values[i] * 255)));
  return {
    base: { source: base.source, width: base.width, height: base.height, data: toBase64(q) },
    mask: mask ? { width: base.width, height: base.height, data: toBase64(mask) } : undefined
  };
}

export function decodeRelief(stored: StoredRelief | undefined): { base: ReliefBase | null; mask: Uint8Array | null } {
  if (!stored?.base) return { base: null, mask: null };
  const q = fromBase64(stored.base.data);
  const values = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) values[i] = q[i] / 255;
  const base: ReliefBase = { source: stored.base.source, width: stored.base.width, height: stored.base.height, values };
  const mask = stored.mask && stored.mask.width === base.width && stored.mask.height === base.height ? fromBase64(stored.mask.data) : null;
  return { base, mask };
}

export function makeProject(name: string, settings: ProjectSettings, sourceAsset: SourceAsset | null, result: PipelineResult | null, relief?: { base: ReliefBase | null; mask: Uint8Array | null }): StackCarveProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    name,
    settings,
    sourceAsset,
    placements: result?.sheets.flatMap(s => s.placements) ?? [],
    relief: relief ? encodeRelief(relief.base, relief.mask) : undefined,
    createdAt: now,
    updatedAt: now
  };
}

/** Fill in any setting a project file predates, so files saved by older builds still open. */
export function mergeSettings(saved: Partial<ProjectSettings> | undefined): ProjectSettings {
  const s = saved ?? {};
  const relief = { ...DEFAULT_SETTINGS.relief, ...(s.relief ?? {}) } as ProjectSettings['relief'] & { useDepthModel?: boolean };
  delete relief.useDepthModel;
  if (s.relief && !('source' in s.relief)) relief.source = 'luminance'; // older projects were brightness based
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    wallArt: { ...DEFAULT_SETTINGS.wallArt, ...(s.wallArt ?? {}) },
    relief,
    ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai ?? {}) },
    rotationDeg: { ...DEFAULT_SETTINGS.rotationDeg, ...(s.rotationDeg ?? {}) }
  };
}

export function parseProject(text: string): StackCarveProject {
  const data = JSON.parse(text) as StackCarveProject;
  if (data.schemaVersion !== 1 || !data.settings) throw new Error('Unsupported StackCarve project file.');
  return { ...data, settings: mergeSettings(data.settings) };
}
