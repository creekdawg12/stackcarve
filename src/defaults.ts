import type { ProjectSettings } from './types';

export const DEFAULT_SETTINGS: ProjectSettings = {
  units: 'in',
  inputMode: 'mesh',
  buildMode: 'statue',
  targetHeight: 4.5,
  materialThickness: 0.75,
  sliceAxis: 'Z',
  rotationDeg: { x: 0, y: 0, z: 0 },
  wallArt: {
    reliefDepth: 6,
    depthScale: 1,
    basePlate: true,
    backZoneDepth: 1,
    rodHoleDiameter: 0.40625,
    backerPlate: false,
    slabDirection: 'horizontal',
    slabGap: 0
  },
  wallThickness: 0.75,
  overlapMargin: 0.5,
  topSolidCaps: 1,
  bottomSolidCaps: 1,
  hollowEnabled: true,
  reliefBaseSolid: true,
  dowelDiameter: 0.375,
  dowelEdgeClearance: 0.25,
  dowelBossDiameter: 1.25,
  sheetWidth: 48,
  sheetHeight: 48,
  sheetEdgeMargin: 0.75,
  partGap: 0.5,
  minFeature: 0.125,
  textHeight: 0.5,
  minTextHeight: 0.2,
  chordTolerance: 0.005,
  allowRotate90: true,
  nestInCutouts: true,
  relief: {
    source: 'depth',
    invert: false,
    blackPoint: 0,
    whitePoint: 1,
    gamma: 1,
    blurPx: 1.2,
    backgroundThreshold: 0.08,
    minIslandArea: 0.15,
    finishedWidth: 20,
    depthFloor: 0,
    baseDepth: 1,
    depth: 2.5
  },
  ai: {
    provider: 'meshy',
    proxyUrl: '',
    apiKeyPresent: false,
    modelType: 'standard',
    targetPolycount: 30000
  }
};

/** Settings that change when the build mode changes, so each mode starts from sensible numbers. */
export const MODE_PRESETS: Record<ProjectSettings['buildMode'], Partial<ProjectSettings>> = {
  statue: { targetHeight: 4.5, materialThickness: 0.75, wallThickness: 0.75, overlapMargin: 0.5, partGap: 0.5, minFeature: 0.125 },
  terraced: { targetHeight: 24, materialThickness: 0.25, wallThickness: 0.75, overlapMargin: 0.375, partGap: 0.3, minFeature: 0.25 },
  slabs: { targetHeight: 24, materialThickness: 0.25, wallThickness: 0.75, overlapMargin: 0.375, partGap: 0.3, minFeature: 0.25 }
};

/** Settings that change when the input changes: photos are always wall art, meshes default to a statue. */
export const INPUT_PRESETS: Record<ProjectSettings['inputMode'], Partial<ProjectSettings>> = {
  mesh: {},
  ai: {},
  relief: { buildMode: 'terraced', materialThickness: 0.25, wallThickness: 0.75, overlapMargin: 0.375, partGap: 0.3, minFeature: 0.25, hollowEnabled: true }
};

/** Above this many pieces the app asks for confirmation; above the hard cap it refuses. */
export const LAYER_SOFT_LIMIT = 120;
export const LAYER_HARD_LIMIT = 400;

export const THICKNESS_PRESETS: { label: string; value: number }[] = [
  { label: '1/8', value: 0.125 },
  { label: '3/16', value: 0.1875 },
  { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5 },
  { label: '23/32', value: 0.703 },
  { label: '3/4', value: 0.75 }
];

export const SHEET_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '48 × 48 (AltMill bed)', width: 48, height: 48 },
  { label: '48 × 96 (full sheet)', width: 48, height: 96 },
  { label: '24 × 48 (half sheet)', width: 24, height: 48 }
];

/** Area of one 4 × 8 ft stock sheet in square inches. */
export const STOCK_SHEET_AREA = 48 * 96;

/** Hugging Face model ids for the in-browser photo tools. */
export const AI_MODELS = {
  depth: 'onnx-community/depth-anything-v2-small',
  /** Tried in order until one loads and returns a usable matte. */
  cutout: [
    { id: 'briaai/RMBG-1.4', label: 'RMBG-1.4', strategy: 'matting-manual', license: 'non-commercial' },
    { id: 'onnx-community/BiRefNet_lite', label: 'BiRefNet lite', strategy: 'pipeline', license: 'MIT' },
    { id: 'Xenova/modnet', label: 'MODNet (portraits)', strategy: 'pipeline', license: 'Apache-2.0' }
  ]
} as const;
export type CutoutCandidate = (typeof AI_MODELS.cutout)[number];
