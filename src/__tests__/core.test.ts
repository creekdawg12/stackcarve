import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { offsetPolygons } from '../geometry/clipper';
import { area } from '../geometry/polygon';
import { DEFAULT_SETTINGS } from '../defaults';
import { runPipeline } from '../engine/pipeline';
import { sheetToDxf } from '../export/dxf';
import type { MeshModel } from '../types';

const square = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];

describe('geometry pipeline', () => {
  it('uses robust integer offsetting', () => {
    const inset = offsetPolygons([square], -1);
    expect(inset).toHaveLength(1);
    expect(area(inset[0])).toBeCloseTo(64, 3);
  });

  it('slices, registers, nests, and exports a simple solid', async () => {
    const geometry = new THREE.BoxGeometry(4, 4, 2);
    const object = new THREE.Group(); object.add(new THREE.Mesh(geometry));
    const mesh: MeshModel = {
      object,
      geometry,
      sourceName: 'box.glb',
      diagnostics: { vertexCount: 24, triangleCount: 12, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, repaired: true, messages: [] }
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      targetHeight: 1.5,
      materialThickness: .75,
      hollowEnabled: false,
      topSolidCaps: 0,
      bottomSolidCaps: 0,
      sheetWidth: 48,
      sheetHeight: 48
    };
    const result = await runPipeline({ settings, mesh });
    expect(result.layers).toHaveLength(2);
    expect(result.layers.every(l => l.parts.length === 1)).toBe(true);
    expect(result.layers[0].parts[0].dowels.length).toBeGreaterThanOrEqual(2);
    expect(result.sheets.length).toBeGreaterThanOrEqual(1);
    const dxf = sheetToDxf(result.sheets[0], result.layers.flatMap(l => l.parts), settings);
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('OUTER_CUT');
    expect(dxf).toContain('INNER_CUT');
    expect(dxf).toContain('DOWEL');
    expect(dxf).toContain('ETCH');
    expect(dxf).toContain('SHEET');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});
