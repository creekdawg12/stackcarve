import type * as THREE from 'three';

export type Axis = 'X' | 'Y' | 'Z';
export type InputMode = 'mesh' | 'relief' | 'ai';
export type AppTab = 'model' | 'slices' | 'sheets';
export type Point2 = { x: number; y: number };
export type Polyline = Point2[];

export interface SourceAsset {
  kind: 'mesh' | 'image';
  name: string;
  mimeType: string;
  dataUrl?: string;
  sizeBytes?: number;
}

export interface ReliefSettings {
  invert: boolean;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  blurPx: number;
  backgroundThreshold: number;
  minIslandArea: number;
  finishedWidth: number;
  useDepthModel: boolean;
}

export interface AiSettings {
  provider: 'meshy';
  proxyUrl: string;
  apiKeyPresent: boolean;
  modelType: 'standard' | 'lowpoly';
  targetPolycount: number;
}

export interface ProjectSettings {
  units: 'in';
  inputMode: InputMode;
  targetHeight: number;
  materialThickness: number;
  sliceAxis: Axis;
  rotationDeg: { x: number; y: number; z: number };
  wallThickness: number;
  overlapMargin: number;
  topSolidCaps: number;
  bottomSolidCaps: number;
  hollowEnabled: boolean;
  reliefBaseSolid: boolean;
  dowelDiameter: number;
  dowelEdgeClearance: number;
  dowelBossDiameter: number;
  sheetWidth: number;
  sheetHeight: number;
  sheetEdgeMargin: number;
  partGap: number;
  minFeature: number;
  textHeight: number;
  minTextHeight: number;
  chordTolerance: number;
  allowRotate90: boolean;
  nestInCutouts: boolean;
  relief: ReliefSettings;
  ai: AiSettings;
}

export interface MeshDiagnostics {
  vertexCount: number;
  triangleCount: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  repaired: boolean;
  messages: string[];
}

export interface MeshModel {
  object: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  diagnostics: MeshDiagnostics;
  sourceName: string;
}

export interface DowelHole {
  x: number;
  y: number;
  diameter: number;
  columnId: string;
  bossAdded?: boolean;
}

export interface StrokeMark {
  polylines: Polyline[];
  text: string;
  height: number;
  omitted?: boolean;
}

export interface Part2D {
  id: string;
  layerIndex: number;
  islandIndex: number;
  label: string;
  outer: Polyline;
  structuralHoles: Polyline[];
  hollowCuts: Polyline[];
  dowels: DowelHole[];
  etch?: StrokeMark;
  sourceArea: number;
  warnings: string[];
}

export interface SliceLayer {
  index: number;
  z: number;
  thickness: number;
  parts: Part2D[];
}

export interface Placement {
  partId: string;
  sheetIndex: number;
  x: number;
  y: number;
  rotation: 0 | 90;
  nestedInPartId?: string;
}

export interface SheetLayout {
  index: number;
  width: number;
  height: number;
  placements: Placement[];
  utilization: number;
}

export interface WarningItem {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  partId?: string;
  layerIndex?: number;
}

export interface PipelineResult {
  layers: SliceLayer[];
  sheets: SheetLayout[];
  warnings: WarningItem[];
  achievedHeight: number;
  utilization: number;
  generatedAt: string;
}

export interface StackCarveProject {
  schemaVersion: 1;
  name: string;
  settings: ProjectSettings;
  sourceAsset: SourceAsset | null;
  placements: Placement[];
  createdAt: string;
  updatedAt: string;
}
