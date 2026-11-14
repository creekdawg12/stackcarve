import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../defaults';
import { buildResult, nominalCount, sourceReady } from '../engine/generate';
import { mergeSettings } from '../export/project';
import { buildChecklist } from '../export/checklist';
import { fieldFromMesh, sampleField } from '../plan/field';
import { basisLabel, hardwareText, rangeText, sizeText, weightText } from '../plan/format';
import { actualPlan, estimatePlan, planNotes } from '../plan/plan';
import { renderFrontPreview, sectionProfile } from '../plan/preview';
import { START_SETTINGS, applyStyle } from '../presets';
import { frameWidthFor, subjectBox } from '../relief/sizing';
import type { MeshModel, ProjectSettings } from '../types';

function boxMesh(w: number, h: number, d: number): MeshModel {
  const geometry = new THREE.BoxGeometry(w, h, d, 2, 2, 2).toNonIndexed();
  const object = new THREE.Group(); object.add(new THREE.Mesh(geometry));
  return { object, geometry, sourceName: 'box.stl', diagnostics: { vertexCount: geometry.getAttribute('position').count, triangleCount: geometry.getAttribute('position').count / 3, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, repaired: true, messages: [] } };
}

describe('projects saved by older builds', () => {
  it('opens with new settings filled in and old meanings kept', () => {
    const old = { inputMode: 'ai', buildMode: 'statue', relief: { finishedWidth: 14, useDepthModel: true }, wallArt: { slabGap: 0.5 } } as unknown as Partial<ProjectSettings>;
    const s = mergeSettings(old);
    // The Meshy generator moved inside the 3D model step.
    expect(s.inputMode).toBe('mesh');
    // Photos used to be sized by the whole frame, by brightness.
    expect(s.relief.sizeTo).toBe('frame');
    expect(s.relief.source).toBe('luminance');
    expect(s.relief.finishedWidth).toBe(14);
    expect('useDepthModel' in s.relief).toBe(false);
    expect(s.wallArt.slabGap).toBe(0.5);
    expect(s.wallArt.rodHoleDiameter).toBe(DEFAULT_SETTINGS.wallArt.rodHoleDiameter);
    expect(s.plan).toEqual(DEFAULT_SETTINGS.plan);
  });

  it('falls back to MDF when a saved material is not one the planner knows', () => {
    const s = mergeSettings({ plan: { material: 'unobtainium', stockOnHand: 2, sheetPrice: null } } as unknown as Partial<ProjectSettings>);
    expect(s.plan.material).toBe('mdf');
    expect(s.plan.stockOnHand).toBe(2);
  });

  it('keeps subject sizing for projects that already have it', () => {
    expect(mergeSettings(START_SETTINGS).relief.sizeTo).toBe('subject');
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('sizing a photo by its subject', () => {
  it('finds the subject box and the frame width that makes it the requested size', () => {
    const width = 100, height = 80;
    const values = new Float32Array(width * height);
    for (let y = 20; y < 60; y++) for (let x = 25; x < 75; x++) values[y * width + x] = 0.5;
    const box = subjectBox(values, width, height, 0.08)!;
    expect(box).toMatchObject({ x0: 25, x1: 74, y0: 20, y1: 59, cols: 50, rows: 40 });
    // The subject spans half the frame, so a 20 in subject needs a frame about 40 in wide.
    expect(frameWidthFor(START_SETTINGS.relief, box, width)).toBeCloseTo(20 * 99 / 50, 6);
    expect(frameWidthFor({ ...START_SETTINGS.relief, sizeTo: 'frame' }, box, width)).toBe(20);
    expect(subjectBox(new Float32Array(100), 10, 10, 0.08)).toBeNull();
    expect(frameWidthFor(START_SETTINGS.relief, null, width)).toBe(20);
  });
});

describe('generating', () => {
  it('knows when a source is ready and roughly how many pieces to expect', () => {
    expect(sourceReady({ settings: START_SETTINGS, mesh: null, reliefBase: null })).toBe(false);
    const mesh = boxMesh(1, 1, 1);
    expect(sourceReady({ settings: { ...START_SETTINGS, inputMode: 'mesh' }, mesh, reliefBase: null })).toBe(true);
    expect(nominalCount(applyStyle(START_SETTINGS, 'plaque'))).toBe(12);
    expect(nominalCount(applyStyle(START_SETTINGS, 'statue'))).toBe(16);
    expect(nominalCount(START_SETTINGS)).toBeGreaterThan(40);
  });

  it('refuses a photo build without a photo', async () => {
    await expect(buildResult({ settings: START_SETTINGS, mesh: null, reliefBase: null, mask: null })).rejects.toThrow(/photo/i);
  });

  it('reads pins, size and cut length off a generated statue', async () => {
    const mesh = boxMesh(4, 6, 3);
    const settings: ProjectSettings = { ...applyStyle(START_SETTINGS, 'statue'), targetHeight: 6, materialThickness: 0.75, sliceAxis: 'Y', hollowEnabled: false };
    const result = await buildResult({ settings, mesh, reliefBase: null, mask: null });
    const plan = actualPlan(result, settings);
    expect(plan.basis).toBe('actual');
    expect(plan.pieces).toBe(8);
    expect(plan.size.height).toBeCloseTo(6, 6);
    expect(plan.size.width).toBeCloseTo(4, 2);
    expect(plan.size.depth).toBeCloseTo(3, 2);
    // A straight box lets both dowel columns run the full height.
    expect(plan.hardware.kind).toBe('pins');
    if (plan.hardware.kind === 'pins') {
      expect(plan.hardware.count).toBe(2);
      expect(plan.hardware.longest).toBeCloseTo(6, 6);
    }
    expect(hardwareText(plan).label).toBe('Dowels');
    // Eight 4 × 3 rectangles: 14 in of outline each, plus two dowel holes per layer.
    expect(plan.cutLength!).toBeGreaterThan(8 * 14);
    expect(plan.cutLength!).toBeLessThan(8 * 14 + 8 * 2 * Math.PI * 0.375 + 1);
    // 4 × 3 × 6 in of MDF at 46 lb per cubic foot, less the dowel holes.
    expect(plan.weightLb).toBeGreaterThan(1.8);
    expect(plan.weightLb).toBeLessThan(72 * 46 / 1728 + 1e-6);
    // The estimate made before generating agrees.
    const est = estimatePlan(settings, fieldFromMesh(mesh.geometry, settings.rotationDeg, 'Y')!);
    expect(est.pieces).toBe(8);
    expect(est.partArea).toBeCloseTo(plan.partArea, 0);
    // And the checklist states the finished size of the piece itself.
    const size = buildChecklist(result, settings).find(i => /Finished size/.test(i.text))!;
    expect(size.text).toBe('Finished size: 4 in wide, 6 in tall, 3 in deep.');
  });
});

describe('plan wording', () => {
  const plan = estimatePlan(START_SETTINGS, sampleField());

  it('says what the numbers are based on', () => {
    expect(basisLabel(plan)).toBe('Rough, for a typical portrait');
    expect(basisLabel({ ...plan, basis: 'source' })).toBe('Estimated from your photo');
    expect(basisLabel({ ...plan, basis: 'actual' })).toBe('As generated');
    expect(planNotes(plan, START_SETTINGS, sampleField()).some(n => n.level === 'info' && /typical portrait/.test(n.text))).toBe(true);
    expect(planNotes({ ...plan, basis: 'source' }, START_SETTINGS, sampleField()).some(n => /Measured off your photo/.test(n.text))).toBe(true);
  });

  it('writes ranges, sizes, weights and hardware the way they are read on the sheet', () => {
    expect(rangeText({ low: 1, likely: 1, high: 1 })).toBe('1');
    expect(rangeText({ low: 2, likely: 2, high: 3 })).toBe('2 to 3');
    expect(sizeText(plan)).toMatch(/^\d+(\.\d)? × \d+(\.\d)? × 3 in$/);
    expect(weightText(0.4)).toBe('under 1 lb');
    expect(weightText(8.64)).toBe('8.6 lb');
    expect(weightText(31.6)).toBe('32 lb');
    const rods = hardwareText(plan);
    expect(rods.label).toBe('Rods');
    expect(rods.detail).toMatch(/13\/32 in holes, \d+ spacers 1\/4 in long/);
    const pins = hardwareText(estimatePlan(applyStyle(START_SETTINGS, 'plaque'), sampleField()));
    expect(pins.label).toBe('Pins');
    expect(pins.value).toMatch(/^\d+ × 0\.5 in$/);
    expect(pins.detail).toBe('Cut from 3/8 in dowel');
  });
});

describe('style preview', () => {
  const field = sampleField();
  const alpha = (p: { rgba: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => p.rgba[(y * p.width + x) * 4 + 3];

  it('draws gapped slabs as strips with the wall showing between them when there is no backer', () => {
    const s: ProjectSettings = { ...START_SETTINGS, wallArt: { ...START_SETTINGS.wallArt, backerPlate: false } };
    const p = renderFrontPreview(s, field)!;
    expect(p.widthIn).toBeCloseTo(20, 0);
    const y = Math.round(p.height / 2);
    let runs = 0, inside = false;
    for (let x = 0; x < p.width; x++) { const on = alpha(p, x, y) > 0; if (on && !inside) runs++; inside = on; }
    // About 40 slabs cross the middle of a 20 in piece at 1/2 in pitch.
    expect(runs).toBeGreaterThanOrEqual(36);
    expect(runs).toBeLessThanOrEqual(42);
    // With a backer plate the gaps are filled with its shadowed face instead.
    const backed = renderFrontPreview(START_SETTINGS, field)!;
    let solid = 0, total = 0;
    for (let x = Math.round(backed.width * 0.3); x < backed.width * 0.7; x++) { total++; if (alpha(backed, x, y) > 0) solid++; }
    expect(solid).toBe(total);
  });

  it('draws a plaque as a solid outline and a side view in whole layers', () => {
    const s = applyStyle(START_SETTINGS, 'plaque');
    const p = renderFrontPreview(s, field)!;
    const y = Math.round(p.height / 2);
    let solid = 0, total = 0;
    for (let x = Math.round(p.width * 0.2); x < p.width * 0.8; x++) { total++; if (alpha(p, x, y) > 0) solid++; }
    expect(solid).toBe(total);
    const section = sectionProfile(s, field)!;
    expect(section.depthIn).toBeLessThanOrEqual(3 + 1e-6);
    for (const band of section.bands) expect(band.depth / 0.25).toBeCloseTo(Math.round(band.depth / 0.25), 6);
    // Side to side slabs show as one rectangle per slab; a statue has no wall and so no side view.
    const stacked: ProjectSettings = { ...applyStyle(START_SETTINGS, 'stack'), wallArt: { ...START_SETTINGS.wallArt, slabDirection: 'horizontal', slabGap: 0 } };
    const slabs = sectionProfile(stacked, field)!;
    expect(slabs.bands.length).toBeGreaterThan(90);
    expect(slabs.bands[0].bottom - slabs.bands[0].top).toBeLessThanOrEqual(0.25 + 1e-6);
    expect(sectionProfile(applyStyle(START_SETTINGS, 'statue'), field)).toBeNull();
  });
});
