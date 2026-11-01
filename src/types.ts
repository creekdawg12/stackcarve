import type * as THREE from 'three';

export type Axis = 'X' | 'Y' | 'Z';
export type InputMode = 'mesh' | 'relief' | 'ai';
/**
 * statue   - free-standing stack, slices along the chosen axis (original behaviour)
 * terraced - wall art, slices parallel to the wall (topo-map look), pins between neighbours
 * slabs    - wall art, horizontal slabs stacked bottom to top, rods through a hidden back zone
 */
export type BuildMode = 'statue' | 'terraced' | 'slabs';
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

export interface WallArtSettings {
  /** Depth of model kept from the front-most point, in inches. 0 keeps the whole model. */
  reliefDepth: number;
  /** Scale applied to depth before cutting, 1 = none, 0.5 = half as deep. */
  depthScale: number;
  /** Terraced: replace the back layer with the full silhouette so the piece reads as a plaque. */
  basePlate: boolean;
  /** Slabs: height of the hidden strip along the flat back edge that holds rods and numbers. */
  backZoneDepth: number;
  /** Slabs: drilled/routed hole size for the alignment rod. */
  rodHoleDiameter: number;
  /** Slabs: add a silhouette backer plate for hanging hardware. */
  backerPlate: boolean;
}

export interface ProjectSettings {
  units: 'in';
  inputMode: InputMode;
  buildMode: BuildMode;
  /** Statue: stack height along the slice axis. Wall art: finished height on the wall. */
  targetHeight: number;
  materialThickness: number;
  sliceAxis: Axis;
  rotationDeg: { x: number; y: number; z: number };
  wallArt: WallArtSettings;
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
  /** Region kept solid regardless of hollowing (slab back zone). */
  keepSolid?: Polyline[];
  /** Special parts that are not slices of the model (backer plate). */
  role?: 'slice' | 'backer';
}

export interface RodInfo {
  columnId: string;
  x: number;
  y: number;
  /** Distance from the flat back edge to the rod centre. */
  offBack: number;
  holeDiameter: number;
  /** Zero-based layer indices of the lowest and highest slab carrying this rod. */
  fromLayer: number;
  toLayer: number;
  /** Suggested rod length in inches (slabs spanned × thickness). */
  length: number;
}

export interface SliceLayer {
  index: number;
  z: number;
  thickness: number;
  parts: Part2D[];
}

export type Rotation = 0 | 90 | 180 | 270;

export interface Placement {
  partId: string;
  sheetIndex: number;
  x: number;
  y: number;
  rotation: Rotation;
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
  buildMode: BuildMode;
  /** Slabs mode only: shared alignment rods. */
  rods: RodInfo[];
  /** Number of 4 × 8 ft stock sheets the nested sheets add up to. */
  stockSheets: number;
  /** Depth of the finished piece off the wall (wall art) or footprint depth (statue). */
  achievedDepth: number;
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
