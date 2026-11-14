import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../defaults';
import { buildResult } from '../engine/generate';
import { composeHeightmap, maskFromThreshold } from '../relief/heightmap';
import { fieldFromHeightmap, fieldFromMesh, sampleField } from '../plan/field';
import { actualPlan, compareRows, estimatePlan, fraction, planNotes } from '../plan/plan';
import { START_SETTINGS, applyStyle, styleOf } from '../presets';
import { bounds } from '../geometry/polygon';
import type { MeshModel, ProjectSettings, ReliefBase } from '../types';

/** Dome depth with a nose bump; the subject fills the middle 90% of the frame. */
function domeBase(width = 240, height = 200): ReliefBase {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (x - width / 2) / (width / 2), dy = (y - height / 2) / (height / 2);
    const r = Math.hypot(dx, dy);
    const nose = Math.exp(-((dx) ** 2 + (dy - 0.1) ** 2) * 25) * 0.4;
    values[y * width + x] = r > 0.9 ? 0.02 : Math.min(1, Math.max(0.05, 0.6 * (1 - r * r) + nose));
  }
  return { source: 'depth', width, height, values };
}

/** A non-convex "dog face" that only fills part of the frame: head, two ears, jowls, nose. */
function dogBase(width = 260, height = 220): ReliefBase {
  const values = new Float32Array(width * height);
  const blobs = [
    { cx: 0, cy: 0.05, rx: 0.5, ry: 0.62, h: 0.75 },
    { cx: -0.5, cy: -0.5, rx: 0.2, ry: 0.26, h: 0.35 },
    { cx: 0.5, cy: -0.5, rx: 0.2, ry: 0.26, h: 0.35 },
    { cx: -0.3, cy: 0.5, rx: 0.28, ry: 0.27, h: 0.6 },
    { cx: 0.3, cy: 0.5, rx: 0.28, ry: 0.27, h: 0.6 },
    { cx: 0, cy: 0.25, rx: 0.18, ry: 0.18, h: 1 }
  ];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (x - width / 2) / (width / 2), dy = (y - height / 2) / (height / 2);
    let v = 0;
    for (const b of blobs) {
      const r2 = ((dx - b.cx) / b.rx) ** 2 + ((dy - b.cy) / b.ry) ** 2;
      if (r2 < 1) v = Math.max(v, 0.12 + b.h * Math.sqrt(1 - r2) * 0.88);
    }
    values[y * width + x] = v;
  }
  return { source: 'depth', width, height, values };
}

function headMesh(): MeshModel {
  const geometry = new THREE.SphereGeometry(1, 64, 48);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const nose = Math.exp(-(Math.pow(n.x, 2) + Math.pow(n.y + 0.15, 2)) * 30) * Math.max(0, n.z) * 0.35;
    const brow = Math.exp(-(Math.pow(n.y - 0.35, 2)) * 40) * Math.max(0, n.z) * 0.08;
    const r = 1 + nose + brow;
    v.set(n.x * 0.8 * r, n.y * 1.1 * r, n.z * 0.9 * r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  const object = new THREE.Group(); object.add(new THREE.Mesh(geometry));
  return { object, geometry, sourceName: 'head.stl', diagnostics: { vertexCount: pos.count, triangleCount: geometry.index!.count / 3, boundaryEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, repaired: true, messages: [] } };
}

const photoBase: ProjectSettings = { ...START_SETTINGS, relief: { ...START_SETTINGS.relief, backgroundThreshold: 0.08 } };

interface Case { name: string; settings: ProjectSettings }
const styles = ['lineart', 'plaque', 'stack'] as const;

function photoCases(): Case[] {
  const out: Case[] = [];
  for (const style of styles) for (const width of [12, 20, 30]) for (const t of [0.25, 0.5]) {
    const s = applyStyle(photoBase, style);
    out.push({ name: `${style} ${width} in wide, ${t} in stock`, settings: { ...s, materialThickness: t, relief: { ...s.relief, finishedWidth: width } } });
  }
  return out;
}

describe('plan estimates against the generated geometry', () => {
  for (const [subject, base] of [['dome', domeBase()], ['dog', dogBase()]] as const) {
    const mask = maskFromThreshold(base, 0.1);
    for (const c of photoCases()) {
      it(`photo ${subject}: ${c.name}`, async () => {
        const map = composeHeightmap(base, { settings: c.settings.relief, mask, preview: false });
        const field = fieldFromHeightmap(map, c.settings.relief.backgroundThreshold);
        const est = estimatePlan(c.settings, field);
        const result = await buildResult({ settings: c.settings, mesh: null, reliefBase: base, mask });
        const act = actualPlan(result, c.settings);

        expect(est.basis).toBe('source');
        expect(act.basis).toBe('actual');
        expect(Math.abs(est.pieces - act.pieces), `pieces ${est.pieces} vs ${act.pieces}`).toBeLessThanOrEqual(Math.max(2, act.pieces * 0.08));
        expect(est.partArea / act.partArea, `part area ${est.partArea.toFixed(0)} vs ${act.partArea.toFixed(0)}`).toBeGreaterThan(0.85);
        expect(est.partArea / act.partArea).toBeLessThan(1.15);
        expect(act.sheets.likely, `sheets ${act.sheets.likely} within ${est.sheets.low} to ${est.sheets.high}`).toBeGreaterThanOrEqual(est.sheets.low);
        expect(act.sheets.likely).toBeLessThanOrEqual(est.sheets.high);
        // The piece comes out the width that was asked for, not the width of the photo frame.
        // A slab stack is a whole number of slabs, so it can miss by up to one pitch.
        const slack = est.mode === 'slabs' ? est.pitch : 0;
        expect(act.size.width, 'finished width').toBeGreaterThan(c.settings.relief.finishedWidth * 0.93 - slack);
        expect(act.size.width).toBeLessThan(c.settings.relief.finishedWidth * 1.04 + slack);
        expect(est.size.width).toBeGreaterThan(act.size.width * 0.93 - slack);
        expect(est.size.width).toBeLessThan(act.size.width * 1.07 + slack);
        expect(est.size.height).toBeGreaterThan(act.size.height * 0.93);
        expect(est.size.height).toBeLessThan(act.size.height * 1.07);
        expect(est.weightLb / act.weightLb, `weight ${est.weightLb.toFixed(1)} vs ${act.weightLb.toFixed(1)} lb`).toBeGreaterThan(0.7);
        expect(est.weightLb / act.weightLb).toBeLessThan(1.4);
      });
    }
  }

  const mesh = headMesh();
  for (const c of [
    { name: 'terraced, 20 in tall', patch: { buildMode: 'terraced' as const, materialThickness: 0.25, targetHeight: 20 }, wall: { reliefDepth: 6 } },
    { name: 'horizontal slabs, 12 in tall', patch: { buildMode: 'slabs' as const, materialThickness: 0.25, targetHeight: 12 }, wall: { reliefDepth: 4, slabDirection: 'horizontal' as const } },
    { name: 'vertical gapped slabs with backer, 24 in tall', patch: { buildMode: 'slabs' as const, materialThickness: 0.25, targetHeight: 24, hollowEnabled: false }, wall: { reliefDepth: 6, slabDirection: 'vertical' as const, slabGap: 0.25, backerPlate: true } },
    { name: 'slabs keeping the whole model, 10 in tall', patch: { buildMode: 'slabs' as const, materialThickness: 0.25, targetHeight: 10 }, wall: { reliefDepth: 0, slabDirection: 'horizontal' as const } },
    { name: 'statue, 12 in tall', patch: { buildMode: 'statue' as const, materialThickness: 0.75, targetHeight: 12, sliceAxis: 'Y' as const }, wall: {} }
  ]) {
    it(`mesh head: ${c.name}`, async () => {
      const settings: ProjectSettings = { ...DEFAULT_SETTINGS, inputMode: 'mesh', wallThickness: 0.75, overlapMargin: 0.375, partGap: 0.3, minFeature: 0.25, ...c.patch, wallArt: { ...DEFAULT_SETTINGS.wallArt, ...c.wall } };
      const field = fieldFromMesh(mesh.geometry, settings.rotationDeg, settings.buildMode === 'statue' ? settings.sliceAxis : 'wall')!;
      expect(field).not.toBeNull();
      const est = estimatePlan(settings, field);
      const result = await buildResult({ settings, mesh, reliefBase: null, mask: null });
      const act = actualPlan(result, settings);
      expect(Math.abs(est.pieces - act.pieces), `pieces ${est.pieces} vs ${act.pieces}`).toBeLessThanOrEqual(Math.max(2, act.pieces * 0.08));
      expect(est.partArea / act.partArea, `part area ${est.partArea.toFixed(0)} vs ${act.partArea.toFixed(0)}`).toBeGreaterThan(0.82);
      expect(est.partArea / act.partArea).toBeLessThan(1.18);
      expect(act.sheets.likely).toBeGreaterThanOrEqual(est.sheets.low);
      expect(act.sheets.likely).toBeLessThanOrEqual(est.sheets.high);
      expect(est.size.height / act.size.height, `height ${est.size.height.toFixed(1)} vs ${act.size.height.toFixed(1)}`).toBeGreaterThan(0.92);
      expect(est.size.height / act.size.height).toBeLessThan(1.08);
      expect(est.size.depth / act.size.depth).toBeGreaterThan(0.9);
      expect(est.size.depth / act.size.depth).toBeLessThan(1.1);
      expect(est.weightLb / act.weightLb, `weight ${est.weightLb.toFixed(1)} vs ${act.weightLb.toFixed(1)} lb`).toBeGreaterThan(0.6);
      expect(est.weightLb / act.weightLb).toBeLessThan(1.6);
    });
  }
});

describe('mesh front field', () => {
  it('measures a unit cube: full coverage, flat front, trusted volume', () => {
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const field = fieldFromMesh(geometry, { x: 0, y: 0, z: 0 }, 'wall', 40)!;
    expect(field.cols).toBe(40);
    expect(field.rows).toBe(40);
    expect(field.inside.reduce((n, v) => n + v, 0)).toBe(1600);
    expect(Math.max(...field.behind)).toBeCloseTo(0, 5);
    expect(field.maxBehind).toBeCloseTo(40, 5);
    // 2 × 2 × 2 model units at 0.05 units per cell is 64,000 cubic cells.
    expect(field.volume).toBeCloseTo(64000, 0);
  });

  it('views a statue with its slice axis up', () => {
    const geometry = new THREE.BoxGeometry(1, 2, 4); // tallest along Z
    const field = fieldFromMesh(geometry, { x: 0, y: 0, z: 0 }, 'Z', 80)!;
    expect(field.rows).toBe(80);
    expect(field.cols).toBe(20);
    expect(field.maxBehind).toBeCloseTo(40, 5);
  });
});

describe('planning before anything is loaded', () => {
  it('opens on line-art wall art from a photo with a usable rough plan', () => {
    expect(styleOf(START_SETTINGS)).toBe('lineart');
    expect(START_SETTINGS.inputMode).toBe('relief');
    const plan = estimatePlan(START_SETTINGS, sampleField());
    expect(plan.basis).toBe('typical');
    expect(plan.mode).toBe('slabs');
    // 20 in wide at 1/4 in stock and 1/4 in gaps is about 40 slabs.
    expect(plan.pieces).toBeGreaterThanOrEqual(38);
    expect(plan.pieces).toBeLessThanOrEqual(41);
    expect(plan.size.width).toBeCloseTo(plan.pieces * 0.5 - 0.25, 6);
    expect(plan.size.height).toBeGreaterThan(20);
    expect(plan.hardware.kind).toBe('rods');
    if (plan.hardware.kind === 'rods') {
      expect(plan.hardware.count).toBe(2);
      expect(plan.hardware.spacers).toBe(2 * (plan.pieces - 1));
    }
    expect(plan.extraParts).toBe(1);
    expect(plan.stock.likely).toBe(1);
    expect(plan.weightLb).toBeGreaterThan(3);
    expect(plan.weightLb).toBeLessThan(25);
    expect(plan.cost).toBeNull();
  });

  it('keeps size, depth and stock when switching between wall-art styles', () => {
    const custom: ProjectSettings = { ...START_SETTINGS, materialThickness: 0.5, relief: { ...START_SETTINGS.relief, finishedWidth: 26, depth: 4 } };
    const plaque = applyStyle(custom, 'plaque');
    expect(styleOf(plaque)).toBe('plaque');
    expect(plaque.materialThickness).toBe(0.5);
    expect(plaque.relief.finishedWidth).toBe(26);
    expect(plaque.relief.depth).toBe(4);
    const stack = applyStyle(plaque, 'stack');
    expect(styleOf(stack)).toBe('stack');
    expect(stack.wallArt.slabGap).toBe(0);
    const back = applyStyle(stack, 'lineart');
    expect(back.wallArt.slabGap).toBe(0.25);
    expect(back.hollowEnabled).toBe(false);
    // A statue is a different kind of piece and brings its own stock and height.
    const statue = applyStyle(custom, 'statue');
    expect(statue.inputMode).toBe('mesh');
    expect(statue.materialThickness).toBe(0.75);
  });

  it('thinner stock means more pieces, more sheets and no less weight', () => {
    const rows = compareRows('thickness', applyStyle(START_SETTINGS, 'plaque'), sampleField());
    expect(rows.map(r => r.label)).toEqual(['1/8 in', '3/16 in', '1/4 in', '1/2 in', '3/4 in']);
    expect(rows.filter(r => r.selected).map(r => r.label)).toEqual(['1/4 in']);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].pieces).toBeLessThanOrEqual(rows[i - 1].pieces);
      expect(rows[i].sheets.likely).toBeLessThanOrEqual(rows[i - 1].sheets.likely);
    }
    expect(rows[0].pieces).toBeGreaterThan(rows[4].pieces * 4);
  });

  it('wider gaps cut the slab count and the wood', () => {
    const rows = compareRows('gap', START_SETTINGS, sampleField());
    expect(rows[0].label).toBe('Touching');
    expect(rows.find(r => r.selected)?.label).toBe('1/4 in gap');
    expect(rows[0].pieces).toBeGreaterThan(rows[2].pieces * 1.8);
    expect(rows[4].pieces).toBeLessThan(rows[2].pieces);
    expect(rows[2].weightLb).toBeLessThan(rows[0].weightLb);
  });

  it('compares the styles a photo can make and leaves the statue out', () => {
    const rows = compareRows('style', START_SETTINGS, sampleField());
    expect(rows.map(r => r.key)).toEqual(['lineart', 'plaque', 'stack']);
    expect(rows.find(r => r.selected)?.key).toBe('lineart');
    const lineart = rows.find(r => r.key === 'lineart')!, stack = rows.find(r => r.key === 'stack')!;
    expect(lineart.pieces).toBeLessThan(stack.pieces);
  });
});

describe('plan notes', () => {
  it('flags a piece wider than the sheet and offers a size that fits', () => {
    const s: ProjectSettings = applyStyle({ ...START_SETTINGS, relief: { ...START_SETTINGS.relief, finishedWidth: 60 } }, 'plaque');
    const field = sampleField();
    const plan = estimatePlan(s, field);
    expect(plan.fitsSheet).toBe(false);
    const stop = planNotes(plan, s, field).find(n => n.level === 'stop');
    expect(stop?.text).toMatch(/largest part/i);
    const fixed = { ...s, ...stop!.fixes![0].patch };
    expect(fixed.relief.finishedWidth).toBeLessThan(60);
    expect(estimatePlan(fixed, field).fitsSheet).toBe(true);
  });

  it('holds the plan to the sheets on hand and suggests ways back inside the budget', () => {
    const s: ProjectSettings = applyStyle({ ...START_SETTINGS, relief: { ...START_SETTINGS.relief, finishedWidth: 34 }, plan: { ...START_SETTINGS.plan, stockOnHand: 1 } }, 'stack');
    const field = sampleField();
    const plan = estimatePlan(s, field);
    expect(plan.stock.low).toBeGreaterThan(1);
    const stop = planNotes(plan, s, field).find(n => /You have 1/.test(n.text));
    expect(stop?.level).toBe('stop');
    expect(stop!.fixes!.length).toBeGreaterThanOrEqual(2);
    for (const fix of stop!.fixes!) {
      expect(estimatePlan({ ...s, ...fix.patch }, field).stock.likely, fix.label).toBeLessThanOrEqual(1);
    }
    expect(stop!.fixes!.some(f => /gaps/.test(f.label))).toBe(true);
    // A plan that probably fits but might not is fixed only by one that fits for certain.
    const tight = { ...s, ...stop!.fixes![0].patch };
    const tightNote = planNotes(estimatePlan(tight, field), tight, field).find(n => /Tight on stock/.test(n.text));
    if (tightNote) for (const fix of tightNote.fixes ?? []) expect(estimatePlan({ ...tight, ...fix.patch }, field).stock.high, fix.label).toBeLessThanOrEqual(1);
    const roomy = { ...s, plan: { ...s.plan, stockOnHand: 6 } };
    expect(planNotes(estimatePlan(roomy, field), roomy, field).some(n => n.level === 'ok' && /Fits the 6 sheets/.test(n.text))).toBe(true);
  });

  it('prices the stock when a sheet price is given', () => {
    const s: ProjectSettings = { ...START_SETTINGS, plan: { ...START_SETTINGS.plan, sheetPrice: 28 } };
    const plan = estimatePlan(s, sampleField());
    expect(plan.cost).toBe(plan.stock.likely * 28);
  });

  it('writes shop fractions', () => {
    expect(fraction(0.25)).toBe('1/4');
    expect(fraction(0.375)).toBe('3/8');
    expect(fraction(0.40625)).toBe('13/32');
    expect(fraction(0.3)).toBe('0.3');
  });
});

describe('subject sizing', () => {
  it('scales the photo so the cut-out subject, not the frame, is the requested width', async () => {
    const base = dogBase();
    const mask = maskFromThreshold(base, 0.1);
    const s: ProjectSettings = applyStyle({ ...photoBase, relief: { ...photoBase.relief, finishedWidth: 18 } }, 'plaque');
    const bySubject = await buildResult({ settings: s, mesh: null, reliefBase: base, mask });
    const first = bounds(bySubject.layers[0].parts[0].outer);
    expect(first.width).toBeGreaterThan(17.6);
    expect(first.width).toBeLessThan(18.2);
    // Projects saved before the planner keep their old meaning: the frame is the stated width.
    const byFrame = await buildResult({ settings: { ...s, relief: { ...s.relief, sizeTo: 'frame' } }, mesh: null, reliefBase: base, mask });
    const frameFirst = bounds(byFrame.layers[0].parts[0].outer);
    expect(frameFirst.width).toBeLessThan(first.width * 0.8);
  });
});
