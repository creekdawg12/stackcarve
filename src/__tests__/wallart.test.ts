import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../defaults';
import { runPipeline } from '../engine/pipeline';
import { sheetToDxf } from '../export/dxf';
import { area, bounds, pointInPolygon, transformPolyline } from '../geometry/polygon';
import { intersectPolygons } from '../geometry/clipper';
import type { MeshModel, PipelineResult, ProjectSettings } from '../types';

/** A watertight "head": an ellipsoid with a gaussian nose bump toward +Z and a chin toward -Y. */
function headMesh(): MeshModel {
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    // nose: bump around the +Z pole, slightly below centre
    const nose = Math.exp(-(Math.pow(n.x, 2) + Math.pow(n.y + 0.15, 2)) * 30) * Math.max(0, n.z) * 0.35;
    // brow ridge: bump above the nose
    const brow = Math.exp(-(Math.pow(n.y - 0.35, 2)) * 40) * Math.max(0, n.z) * 0.08;
    const r = 1 + nose + brow;
    v.set(n.x * 0.8 * r, n.y * 1.1 * r, n.z * 0.9 * r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  const object = new THREE.Group(); object.add(new THREE.Mesh(geometry));
  return { object, geometry, sourceName: 'head.stl', diagnostics: { vertexCount: pos.count, triangleCount: geometry.index!.count / 3, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, repaired: true, messages: [] } };
}

function closedFlags(dxf: string, layer: string) {
  const flags: number[] = [];
  const lines = dxf.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'LWPOLYLINE') {
      let layerName = '', closed = -1;
      for (let j = i; j < Math.min(lines.length, i + 20); j += 2) {
        if (lines[j] === '8') layerName = lines[j + 1];
        if (lines[j] === '70') { closed = Number(lines[j + 1]); break; }
      }
      if (layerName === layer) flags.push(closed);
    }
  }
  return flags;
}

/** Every placed part is inside the margins, nested parts sit inside their host's void, nothing overlaps. */
function assertCleanNesting(result: PipelineResult, settings: ProjectSettings) {
  const parts = result.layers.flatMap(l => l.parts);
  const placedIds = new Set(result.sheets.flatMap(s => s.placements.map(p => p.partId)));
  expect(placedIds.size, 'every part is placed exactly once').toBe(parts.length);
  for (const sheet of result.sheets) {
    const placed = sheet.placements.map(pl => ({ pl, part: parts.find(p => p.id === pl.partId)!, poly: transformPolyline(parts.find(p => p.id === pl.partId)!.outer, pl.x, pl.y, pl.rotation) }));
    for (const { pl, poly } of placed) {
      const b = bounds(poly);
      expect(b.minX).toBeGreaterThanOrEqual(settings.sheetEdgeMargin - 1e-6);
      expect(b.minY).toBeGreaterThanOrEqual(settings.sheetEdgeMargin - 1e-6);
      expect(b.maxX).toBeLessThanOrEqual(sheet.width - settings.sheetEdgeMargin + 1e-6);
      expect(b.maxY).toBeLessThanOrEqual(sheet.height - settings.sheetEdgeMargin + 1e-6);
      if (pl.nestedInPartId) {
        const host = placed.find(h => h.pl.partId === pl.nestedInPartId)!;
        const voids = host.part.hollowCuts.map(h => transformPolyline(h, host.pl.x, host.pl.y, host.pl.rotation));
        expect(poly.every(q => voids.some(v => pointInPolygon(q, v))), `${pl.partId} inside its host void`).toBe(true);
      }
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (a.pl.nestedInPartId === b.pl.partId || b.pl.nestedInPartId === a.pl.partId) continue;
      const overlap = intersectPolygons([a.poly], [b.poly]).reduce((s, p) => s + area(p), 0);
      expect(overlap, `${a.part.label} overlaps ${b.part.label}`).toBeLessThan(1e-4);
    }
  }
}

const wallBase: ProjectSettings = {
  ...DEFAULT_SETTINGS,
  targetHeight: 6,
  materialThickness: 0.25,
  wallThickness: 0.4,
  overlapMargin: 0.2,
  dowelDiameter: 0.1875,
  dowelEdgeClearance: 0.12,
  dowelBossDiameter: 0.6,
  textHeight: 0.3,
  minTextHeight: 0.15,
  minFeature: 0.1,
  wallArt: { ...DEFAULT_SETTINGS.wallArt, reliefDepth: 2, backZoneDepth: 0.6, rodHoleDiameter: 0.2 }
};

describe('wall art modes', () => {
  it('slabs: flat back edge, shared rods in the hidden zone, numbers in the zone, closed DXF contours', async () => {
    const settings: ProjectSettings = { ...wallBase, buildMode: 'slabs', wallArt: { ...wallBase.wallArt, backerPlate: true } };
    const result = await runPipeline({ settings, mesh: headMesh() });
    expect(result.buildMode).toBe('slabs');
    const slabLayers = result.layers.filter(l => l.parts.some(p => p.role === 'slice'));
    // The crown and chin curve back behind the wall plane, so a few of the 24 nominal slabs vanish.
    expect(slabLayers.length).toBeGreaterThanOrEqual(18);
    expect(slabLayers.length).toBeLessThanOrEqual(24);
    expect(slabLayers.map(l => l.index)).toEqual(slabLayers.map((_, i) => i));
    expect(slabLayers[0].parts[0].label).toBe('1');
    expect(result.achievedHeight).toBeCloseTo(slabLayers.length * 0.25, 6);
    expect(result.achievedDepth).toBeCloseTo(2, 6);

    const slabs = slabLayers.flatMap(l => l.parts.filter(p => p.role === 'slice'));
    const backY = Math.min(...slabs.map(p => bounds(p.outer).minY));
    // Most slabs reach the back plane and get a straight back edge there.
    const atBack = slabs.filter(p => Math.abs(bounds(p.outer).minY - backY) < 1e-3);
    expect(atBack.length).toBeGreaterThan(slabs.length * 0.7);
    for (const p of atBack) {
      const onEdge = p.outer.filter(q => Math.abs(q.y - backY) < 1e-3);
      expect(onEdge.length).toBeGreaterThanOrEqual(2);
      // no vertex behind the wall
      expect(Math.min(...p.outer.map(q => q.y))).toBeGreaterThanOrEqual(backY - 1e-6);
    }

    // Rods: at least one column, identical x on every slab that carries it, hole inside the hidden strip.
    expect(result.rods.length).toBeGreaterThanOrEqual(1);
    for (const rod of result.rods) {
      const holes = slabs.flatMap(p => p.dowels.filter(d => d.columnId === rod.columnId).map(d => ({ part: p, d })));
      expect(holes.length).toBeGreaterThan(slabs.length * 0.5);
      for (const { part, d } of holes) {
        expect(d.x).toBeCloseTo(rod.x, 6);
        expect(d.y).toBeLessThanOrEqual(backY + settings.wallArt.backZoneDepth + 1e-6);
        expect(d.y - d.diameter / 2).toBeGreaterThanOrEqual(backY - 1e-6);
        expect(pointInPolygon({ x: d.x, y: d.y }, part.outer)).toBe(true);
        for (const hole of part.hollowCuts) expect(pointInPolygon({ x: d.x, y: d.y }, hole)).toBe(false);
      }
      expect(rod.length).toBeCloseTo((rod.toLayer - rod.fromLayer + 1) * settings.materialThickness, 6);
    }
    const topSlab = slabs.filter(p => p.layerIndex === slabLayers.length - 1);
    for (const p of topSlab) expect(p.dowels).toHaveLength(0);

    // Hollowing never eats the back strip.
    for (const p of slabs) for (const hole of p.hollowCuts) {
      expect(Math.min(...hole.map(q => q.y))).toBeGreaterThan(backY + settings.wallArt.backZoneDepth - 1e-6);
    }

    // Etched numbers live in the back strip.
    const etched = slabs.filter(p => p.etch && !p.etch.omitted);
    expect(etched.length).toBeGreaterThan(slabs.length * 0.5);
    for (const p of etched) for (const line of p.etch!.polylines) for (const q of line) {
      expect(q.y).toBeLessThanOrEqual(backY + settings.wallArt.backZoneDepth + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(backY - 1e-6);
    }

    // Backer plate exists and is the biggest part.
    const backer = result.layers.flatMap(l => l.parts).find(p => p.role === 'backer');
    expect(backer).toBeDefined();
    expect(area(backer!.outer)).toBeGreaterThan(Math.max(...slabs.map(p => area(p.outer))));

    assertCleanNesting(result, settings);

    // DXF: all cut contours closed, etch open.
    const parts = result.layers.flatMap(l => l.parts);
    for (const sheet of result.sheets) {
      const dxf = sheetToDxf(sheet, parts, settings);
      for (const layer of ['OUTER_CUT', 'INNER_CUT', 'DOWEL']) expect(closedFlags(dxf, layer).every(f => f === 1)).toBe(true);
      expect(closedFlags(dxf, 'ETCH').every(f => f === 0)).toBe(true);
    }
    expect(result.stockSheets).toBeGreaterThanOrEqual(1);
  });

  it('terraced: silhouette base, layers shrink toward the nose, hidden pins, no etch on the visible front layer', async () => {
    const settings: ProjectSettings = { ...wallBase, buildMode: 'terraced' };
    const result = await runPipeline({ settings, mesh: headMesh() });
    expect(result.buildMode).toBe('terraced');
    expect(result.layers).toHaveLength(8);
    expect(result.achievedDepth).toBeCloseTo(2, 6);
    expect(result.achievedHeight).toBeCloseTo(6, 6);

    const areas = result.layers.map(l => l.parts.reduce((s, p) => s + area(p.outer), 0));
    expect(areas[0]).toBeGreaterThanOrEqual(Math.max(...areas.slice(1)) - 1e-6);
    // the base silhouette spans most of the finished height (crown and chin curve behind the wall)
    const base = result.layers[0].parts[0];
    expect(bounds(base.outer).height).toBeGreaterThan(4.5);
    expect(bounds(base.outer).height).toBeLessThanOrEqual(6 + 1e-6);
    for (let i = 1; i < areas.length - 1; i++) expect(areas[i]).toBeGreaterThanOrEqual(areas[i + 1] - 1e-6);

    // Hidden pins: the front layer carries no holes, inner interfaces do.
    const front = result.layers[result.layers.length - 1].parts;
    for (const p of front) expect(p.dowels).toHaveLength(0);
    expect(result.layers[0].parts[0].dowels.length).toBeGreaterThanOrEqual(2);
    // Every hole on layer i is covered by layer i+1.
    for (let i = 0; i < result.layers.length - 1; i++) for (const p of result.layers[i].parts) for (const d of p.dowels) {
      expect(result.layers[i + 1].parts.some(q => pointInPolygon({ x: d.x, y: d.y }, q.outer))).toBe(true);
    }

    // Etch: omitted on the front layer, present and covered on the base.
    for (const p of front) expect(p.etch?.omitted).toBe(true);
    expect(base.etch?.omitted).toBeFalsy();
    const cover = result.layers[1].parts[0];
    for (const line of base.etch!.polylines) for (const q of line) expect(pointInPolygon(q, cover.outer)).toBe(true);
    assertCleanNesting(result, settings);
  });

  it('statue: unchanged behaviour with Y-axis slicing keeps a proper rotation', async () => {
    const settings: ProjectSettings = { ...DEFAULT_SETTINGS, targetHeight: 3, materialThickness: 0.5, sliceAxis: 'Y', hollowEnabled: false, topSolidCaps: 0, bottomSolidCaps: 0 };
    const result = await runPipeline({ settings, mesh: headMesh() });
    expect(result.buildMode).toBe('statue');
    expect(result.layers).toHaveLength(6);
    expect(result.rods).toHaveLength(0);
    expect(result.layers[0].parts[0].dowels.length).toBeGreaterThanOrEqual(2);
    assertCleanNesting(result, settings);
  });
});

describe('photo relief', () => {
  it('builds terraced layers from a synthetic dome heightmap with hidden pins and covered labels', async () => {
    const width = 160, height = 120;
    const values = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const dx = (x - width / 2) / (width / 2), dy = (y - height / 2) / (height / 2);
      const r = Math.hypot(dx, dy);
      values[y * width + x] = r > 0.9 ? 0 : Math.max(0, 1 - r * r);
    }
    const settings: ProjectSettings = { ...DEFAULT_SETTINGS, inputMode: 'relief', buildMode: 'terraced', materialThickness: 0.25, wallThickness: 0.6, overlapMargin: 0.3, dowelDiameter: 0.25, dowelEdgeClearance: 0.15, textHeight: 0.3, minTextHeight: 0.15, relief: { ...DEFAULT_SETTINGS.relief, finishedWidth: 12, depth: 1.5 } };
    const result = await runPipeline({ settings, heightmap: { width, height, values, previewUrl: '' } });
    expect(result.buildMode).toBe('terraced');
    // 1.5 in at 0.25 in is 6 terraces; the top one (depth exactly 1.0) has nothing to cut and is trimmed.
    expect(result.layers.length).toBeGreaterThanOrEqual(5);
    expect(result.layers.length).toBeLessThanOrEqual(6);
    expect(result.warnings.some(w => w.id === 'trimmed-layers')).toBe(true);
    const areas = result.layers.map(l => l.parts.reduce((s, p) => s + area(p.outer), 0));
    for (let i = 0; i < areas.length - 1; i++) expect(areas[i]).toBeGreaterThan(areas[i + 1]);
    expect(result.layers[0].parts[0].hollowCuts).toHaveLength(0); // reliefBaseSolid
    expect(result.layers[1].parts[0].hollowCuts.length).toBeGreaterThan(0);
    expect(result.layers[0].parts[0].dowels.length).toBeGreaterThanOrEqual(2);
    const front = result.layers[result.layers.length - 1];
    for (const p of front.parts) { expect(p.dowels).toHaveLength(0); expect(p.etch?.omitted).toBe(true); }
    assertCleanNesting(result, settings);
  });
});
