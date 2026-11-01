import type { BuildMode, MeshModel, Part2D, PipelineResult, Polyline, ProjectSettings, RodInfo, SliceLayer, WarningItem } from '../types';
import { area, bounds } from '../geometry/polygon';
import { prepareGeometry, regionsFromLoops, sectionGeometry, type SectionRegion } from '../mesh/slice';
import { marchingSquares, type HeightmapData } from '../relief/heightmap';
import { slabsFromHeightmap } from '../relief/slabs';
import { applyHollowing } from './hollow';
import { intersectPolygons, offsetPolygons } from '../geometry/clipper';
import { placeDowels } from './dowels';
import { buildEtch } from './hershey';
import { nestParts } from './nest';
import { backStrip, clipRegionsToBack, coveredZone, placeRods, silhouetteOfLayers, slabSilhouette } from './wallart';
import { STOCK_SHEET_AREA } from '../defaults';

function makeLayers(sections: SectionRegion[][], thickness: number): SliceLayer[] {
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
        warnings: [],
        role: 'slice'
      };
    })
  }));
}

/** Fold identical per-part messages into one line so 190 slabs do not produce 190 warnings. */
function collectWarnings(layers: SliceLayer[], seed: WarningItem[]) {
  const warnings = [...seed];
  const grouped = new Map<string, { first: Part2D; layer: number; count: number }>();
  for (const layer of layers) for (const part of layer.parts) {
    for (const message of part.warnings) {
      const g = grouped.get(message);
      if (g) g.count++; else grouped.set(message, { first: part, layer: layer.index, count: 1 });
    }
    if (part.etch?.omitted) {
      const key = part.role === 'backer' ? 'etch-backer' : 'etch';
      const g = grouped.get(key);
      if (g) g.count++; else grouped.set(key, { first: part, layer: layer.index, count: 1 });
    }
  }
  for (const [message, g] of grouped) {
    const text = message === 'etch' || message === 'etch-backer'
      ? `Etched label omitted (no hidden spot or too small); use the sheet map.`
      : message;
    const suffix = g.count > 1 ? ` (${g.count} parts, first: ${g.first.label})` : ` (${g.first.label})`;
    warnings.push({ id: `${g.first.id}-${warnings.length}`, severity: 'warning', message: text + suffix, partId: g.first.id, layerIndex: g.layer });
  }
  return warnings;
}

function axisExtent(box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, axis: 'X' | 'Y' | 'Z') {
  const k = axis.toLowerCase() as 'x' | 'y' | 'z';
  return { min: box.min[k], max: box.max[k] };
}

export async function runPipeline(input: {
  settings: ProjectSettings;
  mesh?: MeshModel | null;
  heightmap?: HeightmapData | null;
}): Promise<PipelineResult> {
  const { settings } = input;
  const t = settings.materialThickness;
  const relief = settings.inputMode === 'relief';
  const mode: BuildMode = relief ? (settings.buildMode === 'slabs' ? 'slabs' : 'terraced') : settings.buildMode;
  const wallArt = mode !== 'statue';
  const gap = mode === 'slabs' ? Math.max(0, settings.wallArt.slabGap) : 0;
  const pitch = t + gap;
  const slabDirection = settings.wallArt.slabDirection;
  const sections: SectionRegion[][] = [];
  const warnings: WarningItem[] = [];
  let achievedHeight = 0;
  let achievedDepth = 0;
  let stackExtent = 0;
  let backY = 0; // slabs: drawing y of the flat back edge

  if (relief) {
    if (!input.heightmap) throw new Error('Load a photo before generating relief slices.');
    if (mode === 'slabs') {
      const r = slabsFromHeightmap(input.heightmap, {
        finishedWidth: settings.relief.finishedWidth,
        reliefDepth: settings.targetHeight,
        baseDepth: Math.min(settings.relief.baseDepth, settings.targetHeight),
        thickness: t,
        gap,
        direction: slabDirection,
        backgroundThreshold: settings.relief.backgroundThreshold,
        simplifyTolerance: Math.max(0.005, settings.minFeature * 0.2),
        minFeature: settings.minFeature,
        minIslandArea: settings.relief.minIslandArea
      });
      sections.push(...r.sections);
      backY = 0;
      achievedDepth = settings.targetHeight;
      stackExtent = r.stackExtent;
      achievedHeight = slabDirection === 'horizontal' ? r.stackExtent : r.finishedHeight;
    } else {
      const layerCount = Math.max(1, Math.round(settings.targetHeight / t));
      achievedHeight = layerCount * t;
      achievedDepth = achievedHeight;
      for (let i = 0; i < layerCount; i++) {
        const terrace = settings.relief.backgroundThreshold + (1 - settings.relief.backgroundThreshold) * (i / Math.max(1, layerCount - 1));
        const loops = marchingSquares(input.heightmap, terrace, settings.relief.finishedWidth, Math.max(0.01, settings.minFeature * 0.25), settings.relief.minIslandArea);
        sections.push(regionsFromLoops(loops));
      }
    }
  } else {
    if (!input.mesh) throw new Error('Load or generate a mesh before slicing.');
    const simplify = Math.max(0.005, settings.minFeature * 0.2);
    if (input.mesh.diagnostics.nonManifoldEdges || input.mesh.diagnostics.boundaryEdges) {
      warnings.push({ id: 'mesh-topology', severity: 'warning', message: 'The source mesh is not fully manifold. All sections are best effort and should be visually checked.' });
    }

    if (mode === 'statue') {
      const layerCount = Math.max(1, Math.round(settings.targetHeight / t));
      achievedHeight = layerCount * t;
      const g = prepareGeometry(input.mesh.geometry, { rotationDeg: settings.rotationDeg, scaleAxis: settings.sliceAxis, scaleTo: achievedHeight });
      const ext = axisExtent(g.boundingBox!, settings.sliceAxis);
      const depthAxis = settings.sliceAxis === 'Z' ? 'Y' : 'Z';
      const d = axisExtent(g.boundingBox!, depthAxis);
      achievedDepth = d.max - d.min;
      for (let i = 0; i < layerCount; i++) sections.push(sectionGeometry(g, ext.min + (i + 0.5) * t, settings.sliceAxis, simplify));
    } else {
      // Wall art: model is oriented Y up, face toward +Z. Height on the wall sets the scale.
      const wa = settings.wallArt;
      const g = prepareGeometry(input.mesh.geometry, { rotationDeg: settings.rotationDeg, scaleAxis: 'Y', scaleTo: settings.targetHeight, depthScale: wa.depthScale });
      const box = g.boundingBox!;
      const modelDepth = box.max.z - box.min.z;
      const keepDepth = wa.reliefDepth > 0 ? Math.min(wa.reliefDepth, modelDepth) : modelDepth;
      const backZ = box.max.z - keepDepth;

      if (mode === 'terraced') {
        const layerCount = Math.max(1, Math.round(keepDepth / t));
        achievedDepth = layerCount * t;
        achievedHeight = settings.targetHeight;
        const start = box.max.z - achievedDepth; // layer 0 sits against the wall
        for (let i = 0; i < layerCount; i++) sections.push(sectionGeometry(g, start + (i + 0.5) * t, 'Z', simplify));
        if (keepDepth >= modelDepth - 1e-6 && wa.reliefDepth > 0 && wa.reliefDepth > modelDepth + 1e-6) {
          warnings.push({ id: 'depth-clamped', severity: 'info', message: `Relief depth clamped to the model depth of ${modelDepth.toFixed(2)} in.` });
        }
      } else {
        // Horizontal slabs are Y sections stacked bottom to top; vertical slabs are X sections
        // stacked from the viewer's left to right. Either way the drawing y is model Z (depth).
        const axis = slabDirection === 'horizontal' ? 'Y' : 'X';
        const ext = axisExtent(box, axis);
        const span = ext.max - ext.min;
        const layerCount = Math.max(1, Math.round((span + gap) / pitch));
        stackExtent = layerCount * pitch - gap;
        achievedHeight = slabDirection === 'horizontal' ? stackExtent : settings.targetHeight;
        achievedDepth = keepDepth;
        backY = backZ;
        for (let i = 0; i < layerCount; i++) {
          const regions = sectionGeometry(g, ext.min + i * pitch + t / 2, axis, simplify);
          sections.push(keepDepth < modelDepth - 1e-6 ? clipRegionsToBack(regions, backY) : regions);
        }
        if (keepDepth >= modelDepth - 1e-6) {
          backY = box.min.z;
          warnings.push({ id: 'slabs-no-back-cut', severity: 'info', message: 'No back cut: slabs keep the model\'s curved back, so only slabs that reach the back plane can take rods. Set a relief depth to give every slab a flat back.' });
        }
      }
    }
  }

  // Slivers thinner than the minimum feature cannot be cut; drop them rather than nesting junk.
  let slivers = 0;
  for (const regions of sections) {
    for (let k = regions.length - 1; k >= 0; k--) {
      const b = bounds(regions[k].outer);
      if (Math.min(b.width, b.height) < settings.minFeature || !offsetPolygons([regions[k].outer], -settings.minFeature / 2).length) {
        regions.splice(k, 1);
        slivers++;
      }
    }
  }
  if (slivers) warnings.push({ id: 'slivers-dropped', severity: 'info', message: `${slivers} sliver${slivers === 1 ? '' : 's'} thinner than ${settings.minFeature.toFixed(3)} in dropped (tips of the model that are too small to cut).` });

  // Wall art: slabs or layers that fall entirely behind the back plane do not exist. Trim them
  // from the ends so numbering starts at the first real piece.
  if (wallArt && (!relief || mode === 'slabs')) {
    let first = 0, last = sections.length - 1;
    while (first <= last && !sections[first].length) first++;
    while (last >= first && !sections[last].length) last--;
    const dropped = sections.length - (last - first + 1);
    if (dropped > 0 && last >= first) {
      sections.splice(last + 1);
      sections.splice(0, first);
      if (mode === 'slabs') {
        stackExtent = sections.length * pitch - gap;
        if (slabDirection === 'horizontal') achievedHeight = stackExtent;
      } else achievedDepth = sections.length * t;
      const what = mode === 'slabs' ? (slabDirection === 'horizontal' ? 'height' : 'width') : 'depth';
      const size = mode === 'slabs' ? stackExtent : sections.length * t;
      warnings.push({ id: 'trimmed-layers', severity: 'info', message: `${dropped} ${mode === 'slabs' ? 'slab' : 'layer'}${dropped === 1 ? '' : 's'} at the ends had nothing to cut (behind the back plane or too thin) and ${dropped === 1 ? 'was' : 'were'} dropped. Finished ${what} is ${size.toFixed(2)} in.` });
    }
  }
  for (let i = 0; i < sections.length; i++) {
    if (!sections[i].length && (wallArt || (i > 0 && i < sections.length - 1))) {
      warnings.push({ id: `gap-layer-${i}`, severity: 'warning', message: `${mode === 'slabs' ? 'Slab' : 'Layer'} ${i + 1} has nothing cuttable; shim that position with a scrap of the same stock.`, layerIndex: i });
    }
  }

  const layers = makeLayers(sections, t);

  // Terraced: swap the back layer for the full silhouette so the piece hangs as one plaque.
  if (mode === 'terraced' && !relief && settings.wallArt.basePlate && layers.length) {
    const silhouette = silhouetteOfLayers(layers);
    if (silhouette.length) {
      const regions = regionsFromLoops(silhouette);
      layers[0].parts = makeLayers([regions], t)[0].parts;
    }
  }

  for (const layer of layers) {
    if (!layer.parts.length && !wallArt) warnings.push({ id: `empty-layer-${layer.index}`, severity: 'warning', message: `Layer ${layer.index + 1} has no closed section contours.`, layerIndex: layer.index });
    for (const part of layer.parts) {
      if (mode === 'slabs') part.keepSolid = [backStrip(part.outer, backY, settings.wallArt.backZoneDepth)];
    }
  }

  if (mode === 'slabs' && gap > 0 && settings.hollowEnabled) {
    warnings.push({ id: 'gap-hollow', severity: 'info', message: `Slabs are gapped ${gap.toFixed(3)} in, so hollow voids can be seen through the gaps from the side. Turn hollowing off for a clean look, or keep it to save wood.` });
  }
  applyHollowing(layers, {
    enabled: settings.hollowEnabled,
    wall: settings.wallThickness,
    overlap: settings.overlapMargin,
    bottomCaps: settings.bottomSolidCaps,
    topCaps: settings.topSolidCaps,
    reliefMode: relief,
    reliefBaseSolid: settings.reliefBaseSolid,
    minFeature: settings.minFeature
  });

  let rods: RodInfo[] = [];
  if (mode === 'slabs') {
    const placed = placeRods(layers, { backY, zoneDepth: settings.wallArt.backZoneDepth, holeDiameter: settings.wallArt.rodHoleDiameter, edgeClearance: settings.dowelEdgeClearance, thickness: t, pitch, gap });
    rods = placed.rods;
    warnings.push(...placed.warnings);
  } else {
    warnings.push(...placeDowels(layers, settings.dowelDiameter, settings.dowelEdgeClearance, settings.dowelBossDiameter, { hidePins: wallArt }));
  }

  // Slabs: optional silhouette backer plate for hanging hardware, cut from the same stock.
  if (mode === 'slabs' && settings.wallArt.backerPlate && layers.length) {
    const outline = slabSilhouette(layers, t, pitch, slabDirection).flatMap(p => offsetPolygons([p], -0.25));
    if (outline.length) {
      const regions = regionsFromLoops(outline);
      const backerLayer: SliceLayer = { index: layers.length, z: 0, thickness: t, parts: [] };
      backerLayer.parts = regions.map((region, i): Part2D => ({
        id: `BK${i + 1}`, layerIndex: layers.length, islandIndex: i, label: `BK${regions.length > 1 ? i + 1 : ''}`,
        outer: region.outer, structuralHoles: region.holes, hollowCuts: [], dowels: [], sourceArea: area(region.outer), warnings: [], role: 'backer'
      }));
      layers.push(backerLayer);
      warnings.push({ id: 'backer-info', severity: 'info', message: 'Backer plate added (BK): glue the flat back edges of the slabs to it and mount hanging hardware on its back.' });
    }
  }

  const sliceCount = layers.filter(l => l.parts.some(p => p.role !== 'backer')).length;
  for (let i = 0; i < layers.length; i++) {
    for (const part of layers[i].parts) {
      if (part.role === 'backer') { part.etch = buildEtch(part, part.label, settings.textHeight, settings.minTextHeight); continue; }
      const totalText = `${part.label}/${sliceCount}`;
      let zones: Polyline[] = coveredZone(part, layers[i + 1], 0.1);
      if (mode === 'slabs' && part.keepSolid) {
        // Prefer the covered part of the back strip, then the whole strip (only visible from above).
        const covered = zones.length ? intersectPolygons(zones, part.keepSolid) : [];
        zones = covered.length ? covered : intersectPolygons(offsetPolygons([part.outer], -0.1), part.keepSolid);
      }
      part.etch = buildEtch(part, totalText, settings.textHeight, settings.minTextHeight, { zones, requireZone: wallArt });
    }
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
  const stockSheets = Math.ceil((sheets.length * settings.sheetWidth * settings.sheetHeight) / STOCK_SHEET_AREA - 1e-9);

  return {
    layers,
    sheets,
    warnings: collectWarnings(layers, warnings),
    achievedHeight,
    achievedDepth,
    utilization,
    generatedAt: new Date().toISOString(),
    buildMode: mode,
    rods,
    stockSheets,
    pitch,
    slabDirection,
    stackExtent
  };
}
