import type { ProjectSettings } from './types';

export const DEFAULT_SETTINGS: ProjectSettings = {
  units: 'in',
  inputMode: 'mesh',
  targetHeight: 4.5,
  materialThickness: 0.75,
  sliceAxis: 'Z',
  rotationDeg: { x: 0, y: 0, z: 0 },
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
    invert: false,
    blackPoint: 0,
    whitePoint: 1,
    gamma: 1,
    blurPx: 1.2,
    backgroundThreshold: 0.08,
    minIslandArea: 0.15,
    finishedWidth: 24,
    useDepthModel: false
  },
  ai: {
    provider: 'meshy',
    proxyUrl: '',
    apiKeyPresent: false,
    modelType: 'standard',
    targetPolycount: 30000
  }
};
