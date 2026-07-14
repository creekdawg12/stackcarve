import type { MeshModel, Part2D, PipelineResult, Polyline, ProjectSettings, SliceLayer, WarningItem } from '../types';
import { area, bounds, centroid, ensureCCW, ensureCW, pointInPolygon } from '../geometry/polygon';
import { sectionGeometry, transformedGeometryVertices, type SectionRegion } from '../mesh/slice';
import { marchingSquares, type HeightmapData } from '../relief/heightmap';
import { applyHollowing } from './hollow';
import { offsetPolygons } from '../geometry/clipper';
import { placeDowels } from './dowels';
import { buildEtch } from './hershey';
import { nestParts } from './nest';

function regionsFromLoops(loops: Polyline[]): SectionRegion[] {
  const sorted = loops.slice().sort((a, b) => area(b) - area(a));
  const regions: SectionRegion[] = [];
  for (const loop of sorted) {
    const c = centroid(loop);
    const parent = regions.find(r => pointInPolygon(c, r.outer));
    if (parent) parent.holes.push(ensureCW(loop));
    else regions.push({ outer: ensureCCW(loop), holes: [] });
  }
  return regions;
}

function makeLayers(sections: SectionRegion[][], thickness: number): SliceLayer[] {
  const total = sections.length;
  return sections.map((regions, layerIndex) => ({
    index: layerIndex,
    z: (layerIndex + 0.5) * thickness,
    thickness,
    parts: regions.map((region, islandIndex): Part2D => {
      const suffix = regions.length > 1 ? String.fromCharCode(65 + islandIndex) : '';
      return {
        id: `L${layerIndex + 1}${suffix || 'A'}`,
        layerIndex,
        islandIndex,
        label: `${layerIndex + 1}${suffix}`,
        outer: region.outer,
        structuralHoles: region.holes,
        hollowCuts: [],
        dowels: [],
        sourceArea: area(region.outer),
        warnings: []
      };
    })
  }));
}

function collectWarnings(layers: SliceLayer[], seed: WarningItem[]) {
  const warnings = [...seed];
  for (const layer of layers) for (const part of layer.parts) {
    for (const message of part.warnings) warnings.push({ id: `${part.id}-${warnings.length}`, severity: 'warning', message, partId: part.id, layerIndex: layer.index });
    if (part.etch?.omitted) warnings.push({ id: `etch-${part.id}`, severity: 'warning', message: `Etched label omitted on ${part.label}; use the sheet map.`, partId: part.id, layerIndex: layer.index });
  }
  return warnings;
}

export async function runPipeline(input: {
  settings: ProjectSettings;
  mesh?: MeshModel | null;
  heightmap?: HeightmapData | null;
}): Promise<PipelineResult> {
  const { settings } = input;
  const layerCount = Math.max(1, Math.round(settings.targetHeight / settings.materialThickness));
  const achievedHeight = layerCount * settings.materialThickness;
  const sections: SectionRegion[][] = [];
  const warnings: WarningItem[] = [];

  if (settings.inputMode === 'relief') {
    if (!input.heightmap) throw new Error('Load a photo before generating relief slices.');
    for (let i = 0; i < layerCount; i++) {
      const terrace = settings.relief.backgroundThreshold + (1 - settings.relief.backgroundThreshold) * (i / Math.max(1, layerCount - 1));
      const loops = marchingSquares(input.heightmap, terrace, settings.relief.finishedWidth, Math.max(0.01, settings.minFeature * 0.25), settings.relief.minIslandArea);
      sections.push(regionsFromLoops(loops));
    }
  } else {
    if (!input.mesh) throw new Error('Load or generate a mesh before slicing.');
    const g = transformedGeometryVertices(input.mesh.geometry, settings.rotationDeg, settings.sliceAxis, achievedHeight);
    const box = g.boundingBox!;
    const min = settings.sliceAxis === 'X' ? box.min.x : settings.sliceAxis === 'Y' ? box.min.y : box.min.z;
    for (let i = 0; i < layerCount; i++) {
      const plane = min + (i + 0.5) * settings.materialThickness;
      sections.push(sectionGeometry(g, plane, settings.sliceAxis, Math.max(0.005, settings.minFeature * 0.2)));
    }
    if (input.mesh.diagnostics.nonManifoldEdges || input.mesh.diagnostics.boundaryEdges) {
      warnings.push({ id: 'mesh-topology', severity: 'warning', message: 'The source mesh is not fully manifold. All sections are best effort and should be visually checked.' });
    }
  }

  const layers = makeLayers(sections, settings.materialThickness);
  for (const layer of layers) {
    if (!layer.parts.length) warnings.push({ id: `empty-layer-${layer.index}`, severity: 'warning', message: `Layer ${layer.index + 1} has no closed section contours.`, layerIndex: layer.index });
    for (const part of layer.parts) {
      const b = bounds(part.outer);
      if (Math.min(b.width, b.height) < settings.minFeature || !offsetPolygons([part.outer], -settings.minFeature / 2).length) {
        part.warnings.push(`Minimum feature check failed at ${settings.minFeature.toFixed(3)} in.`);
      }
    }
  }
  applyHollowing(layers, {
    enabled: settings.hollowEnabled,
    wall: settings.wallThickness,
    overlap: settings.overlapMargin,
    bottomCaps: settings.bottomSolidCaps,
    topCaps: settings.topSolidCaps,
    reliefMode: settings.inputMode === 'relief',
    reliefBaseSolid: settings.reliefBaseSolid
  });
  warnings.push(...placeDowels(layers, settings.dowelDiameter, settings.dowelEdgeClearance, settings.dowelBossDiameter));

  for (const layer of layers) for (const part of layer.parts) {
    const totalText = `${part.label}/${layers.length}`;
    part.etch = buildEtch(part, totalText, settings.textHeight, settings.minTextHeight);
  }

  const parts = layers.flatMap(l => l.parts);
  const sheets = nestParts(parts, {
    width: settings.sheetWidth,
    height: settings.sheetHeight,
    margin: settings.sheetEdgeMargin,
    gap: settings.partGap,
    rotate90: settings.allowRotate90,
    nestInCutouts: settings.nestInCutouts
  });
  const utilization = sheets.length ? sheets.reduce((s, sh) => s + sh.utilization, 0) / sheets.length : 0;

  return {
    layers,
    sheets,
    warnings: collectWarnings(layers, warnings),
    achievedHeight,
    utilization,
    generatedAt: new Date().toISOString()
  };
}
