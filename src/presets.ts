import { DEFAULT_SETTINGS } from './defaults';
import type { ProjectSettings } from './types';

export type StyleId = 'plaque' | 'lineart' | 'stack' | 'statue';

export interface StyleDef {
  id: StyleId;
  label: string;
  /** One line under the picker saying what the finished piece is. */
  blurb: string;
  /** Statues cannot be made from a flat photo. */
  needsModel?: boolean;
  /** Settings to change when this style is picked. Size, depth and stock survive a switch between wall-art styles. */
  apply: (s: ProjectSettings) => Partial<ProjectSettings>;
}

const WALL_ART_CUT = { wallThickness: 0.75, overlapMargin: 0.375, minFeature: 0.25, partGap: 0.3 } as const;

/** Stock and size that only reset when the piece changes kind (statue to wall art or back). */
function wallArtBasics(s: ProjectSettings): Partial<ProjectSettings> {
  if (s.buildMode !== 'statue') return {};
  return { materialThickness: 0.25, targetHeight: 20 };
}

export const STYLES: StyleDef[] = [
  {
    id: 'lineart', label: 'Line-art slabs',
    blurb: 'Slabs on edge with open gaps between them, held on two hidden rods. Uses the least wood.',
    apply: s => ({
      ...wallArtBasics(s), ...WALL_ART_CUT, buildMode: 'slabs', hollowEnabled: false,
      relief: { ...s.relief, depth: s.buildMode === 'statue' ? 3 : s.relief.depth, baseDepth: 1 },
      wallArt: {
        ...s.wallArt, backerPlate: true, backZoneDepth: 1,
        slabGap: s.wallArt.slabGap > 0 ? s.wallArt.slabGap : 0.25,
        slabDirection: s.buildMode === 'slabs' ? s.wallArt.slabDirection : 'vertical'
      }
    })
  },
  {
    id: 'plaque', label: 'Face plaque',
    blurb: 'Layers flat against the wall, stepping toward you like a contour map.',
    apply: s => ({
      ...wallArtBasics(s), ...WALL_ART_CUT, buildMode: 'terraced', hollowEnabled: true,
      relief: { ...s.relief, depth: s.buildMode === 'statue' ? 2.5 : s.relief.depth, baseDepth: 1 },
      wallArt: { ...s.wallArt, slabGap: 0, basePlate: true }
    })
  },
  {
    id: 'stack', label: 'Solid slabs',
    blurb: 'Slabs on edge, touching, for a solid carved look. Hollowed inside to save wood.',
    apply: s => ({
      ...wallArtBasics(s), ...WALL_ART_CUT, buildMode: 'slabs', hollowEnabled: true,
      relief: { ...s.relief, depth: s.buildMode === 'statue' ? 3 : s.relief.depth, baseDepth: 1 },
      wallArt: {
        ...s.wallArt, slabGap: 0, backerPlate: false,
        slabDirection: s.buildMode === 'slabs' ? s.wallArt.slabDirection : 'horizontal'
      }
    })
  },
  {
    id: 'statue', label: 'Statue', needsModel: true,
    blurb: 'A free-standing stack sliced from a 3D model, aligned on two dowels.',
    apply: s => ({
      inputMode: 'mesh', buildMode: 'statue', hollowEnabled: true, wallThickness: 0.75, overlapMargin: 0.5, minFeature: 0.125, partGap: 0.5,
      ...(s.buildMode === 'statue' ? {} : { materialThickness: 0.75, targetHeight: 12 })
    })
  }
];

/** Which style the current settings amount to. Derived, so it can never disagree with the build. */
export function styleOf(s: ProjectSettings): StyleId {
  const mode = s.inputMode === 'relief' && s.buildMode === 'statue' ? 'terraced' : s.buildMode;
  if (mode === 'statue') return 'statue';
  if (mode === 'terraced') return 'plaque';
  return s.wallArt.slabGap > 0 ? 'lineart' : 'stack';
}

export function applyStyle(s: ProjectSettings, id: StyleId): ProjectSettings {
  const style = STYLES.find(x => x.id === id);
  return style ? { ...s, ...style.apply(s) } : s;
}

/** What a brand-new project opens with: line-art wall art from a photo, the most common build. */
export const START_SETTINGS: ProjectSettings = applyStyle({ ...DEFAULT_SETTINGS, inputMode: 'relief', hollowEnabled: true }, 'lineart');
