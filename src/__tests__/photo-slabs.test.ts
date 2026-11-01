import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../defaults';
import { runPipeline } from '../engine/pipeline';
import { composeHeightmap, maskFromThreshold, normalizeDepth, resampleGrid } from '../relief/heightmap';
import { slabsFromHeightmap } from '../relief/slabs';
import { area, bounds } from '../geometry/polygon';
import type { ProjectSettings, ReliefBase } from '../types';
import type { HeightmapData } from '../relief/heightmap';

/** Dome depth with an off-centre "nose" bump; background outside r = 0.9. */
function domeBase(width = 120, height = 96): ReliefBase {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (x - width / 2) / (width / 2), dy = (y - height / 2) / (height / 2);
    const r = Math.hypot(dx, dy);
    const nose = Math.exp(-((dx) ** 2 + (dy - 0.1) ** 2) * 25) * 0.4;
    values[y * width + x] = r > 0.9 ? 0.02 : Math.min(1, Math.max(0.05, 0.6 * (1 - r * r) + nose));
  }
  return { source: 'depth', width, height, values };
}

const relief = { ...DEFAULT_SETTINGS.relief, finishedWidth: 12, backgroundThreshold: 0.08 };

describe('photo heightmap tools', () => {
  it('normalises and resamples model depth', () => {
    const raw = new Float32Array([5, 10, 15, 20]);
    const n = normalizeDepth(raw);
    [0, 1 / 3, 2 / 3, 1].forEach((v, i) => expect(n[i]).toBeCloseTo(v, 6));
    const up = resampleGrid(n, 2, 2, 3, 3);
    expect(up).toHaveLength(9);
    expect(up[4]).toBeCloseTo(0.5, 6);
  });

  it('composes with a mask so the silhouette follows the mask exactly', () => {
    const base = domeBase();
    const mask = maskFromThreshold(base, 0.1);
    const map = composeHeightmap(base, { settings: relief, mask, preview: false });
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) expect(map.values[i]).toBeGreaterThanOrEqual(relief.backgroundThreshold);
      else expect(map.values[i]).toBe(0);
    }
    const floored = composeHeightmap(base, { settings: { ...relief, depthFloor: 0.5 }, mask, preview: false });
    // Pushing the wall plane forward lowers everything but keeps the mask.
    let lower = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] && floored.values[i] < map.values[i] - 1e-6) lower++;
    expect(lower).toBeGreaterThan(mask.length * 0.3);
  });
});

describe('slabs from a heightmap', () => {
  const base = domeBase();
  const mask = maskFromThreshold(base, 0.1);
  const map: HeightmapData = composeHeightmap(base, { settings: relief, mask, preview: false });
  const common = { finishedWidth: 12, reliefDepth: 3, baseDepth: 0.75, thickness: 0.25, backgroundThreshold: 0.08, simplifyTolerance: 0.01, minFeature: 0.2 };

  it('horizontal: one slab per band, flat back at y = 0, depths between base and relief depth', () => {
    const r = slabsFromHeightmap(map, { ...common, gap: 0, direction: 'horizontal' });
    const finishedHeight = 12 * (map.height - 1) / (map.width - 1);
    expect(r.finishedHeight).toBeCloseTo(finishedHeight, 6);
    expect(r.sections.length).toBe(Math.round(finishedHeight / 0.25));
    expect(r.pitch).toBeCloseTo(0.25, 9);
    const withParts = r.sections.filter(s => s.length);
    expect(withParts.length).toBeGreaterThan(r.sections.length * 0.6);
    for (const regions of withParts) for (const region of regions) {
      const b = bounds(region.outer);
      expect(b.minY).toBeCloseTo(0, 6);
      expect(b.maxY).toBeGreaterThanOrEqual(0.75 - 1e-6);
      expect(b.maxY).toBeLessThanOrEqual(3 + 1e-6);
      expect(b.width).toBeLessThanOrEqual(12 + 1e-6);
      expect(region.holes).toHaveLength(0);
    }
    // The middle slab is the widest (dome), the nose makes it the deepest too.
    const mid = r.sections[Math.floor(r.sections.length / 2)][0];
    const edge = withParts[0][0];
    expect(bounds(mid.outer).width).toBeGreaterThan(bounds(edge.outer).width);
    expect(bounds(mid.outer).maxY).toBeGreaterThan(bounds(edge.outer).maxY);
  });

  it('vertical: slabs span the finished width, drawing x runs up the wall', () => {
    const r = slabsFromHeightmap(map, { ...common, gap: 0, direction: 'vertical' });
    expect(r.sections.length).toBe(Math.round(12 / 0.25));
    const parts = r.sections.flat();
    const xMax = Math.max(...parts.map(p => bounds(p.outer).maxX));
    expect(xMax).toBeLessThanOrEqual(r.finishedHeight + 1e-6);
    expect(xMax).toBeGreaterThan(r.finishedHeight * 0.8);
    for (const p of parts) expect(bounds(p.outer).minY).toBeCloseTo(0, 6);
  });

  it('gaps: pitch grows, slab count shrinks, and extent includes the gaps', () => {
    const touching = slabsFromHeightmap(map, { ...common, gap: 0, direction: 'horizontal' });
    const gapped = slabsFromHeightmap(map, { ...common, gap: 0.25, direction: 'horizontal' });
    expect(gapped.pitch).toBeCloseTo(0.5, 9);
    expect(gapped.sections.length).toBeLessThan(touching.sections.length);
    expect(gapped.sections.length).toBe(Math.round((touching.finishedHeight + 0.25) / 0.5));
    expect(gapped.stackExtent).toBeCloseTo(gapped.sections.length * 0.5 - 0.25, 9);
  });

  it('runs through the full pipeline with rods, spacers and a backer, in both directions', async () => {
    for (const direction of ['horizontal', 'vertical'] as const) {
      const settings: ProjectSettings = {
        ...DEFAULT_SETTINGS,
        inputMode: 'relief',
        buildMode: 'slabs',
        targetHeight: 3,
        materialThickness: 0.25,
        minFeature: 0.2,
        wallThickness: 0.5,
        overlapMargin: 0.2,
        dowelEdgeClearance: 0.12,
        textHeight: 0.3,
        minTextHeight: 0.15,
        relief: { ...relief, baseDepth: 0.75 },
        wallArt: { ...DEFAULT_SETTINGS.wallArt, slabDirection: direction, slabGap: 0.25, backZoneDepth: 0.6, rodHoleDiameter: 0.2, backerPlate: true }
      };
      const result = await runPipeline({ settings, heightmap: map });
      expect(result.buildMode).toBe('slabs');
      expect(result.slabDirection).toBe(direction);
      expect(result.pitch).toBeCloseTo(0.5, 9);
      const slabs = result.layers.flatMap(l => l.parts.filter(p => p.role === 'slice'));
      expect(slabs.length).toBeGreaterThan(10);
      expect(result.rods.length).toBeGreaterThanOrEqual(1);
      for (const rod of result.rods) {
        expect(rod.length).toBeCloseTo((rod.toLayer - rod.fromLayer) * 0.5 + 0.25, 6);
        expect(rod.spacerCount).toBe(rod.toLayer - rod.fromLayer);
        expect(rod.spacerLength).toBeCloseTo(0.25, 9);
        for (const p of slabs) for (const d of p.dowels.filter(d => d.columnId === rod.columnId)) {
          expect(d.x).toBeCloseTo(rod.x, 6);
          expect(d.y).toBeLessThanOrEqual(0.6 + 1e-6);
          expect(d.y - d.diameter / 2).toBeGreaterThanOrEqual(-1e-6);
        }
      }
      expect(result.stackExtent).toBeCloseTo(slabs.length ? result.layers.filter(l => l.parts.some(p => p.role === 'slice')).length * 0.5 - 0.25 : 0, 6);
      const backer = result.layers.flatMap(l => l.parts).find(p => p.role === 'backer');
      expect(backer).toBeDefined();
      // Backer spans the whole stack including the gaps, and is one piece.
      const bb = bounds(backer!.outer);
      const spanAxis = direction === 'horizontal' ? bb.height : bb.width;
      expect(spanAxis).toBeGreaterThan(result.stackExtent - 0.6);
      expect(result.layers.flatMap(l => l.parts).filter(p => p.role === 'backer')).toHaveLength(1);
      expect(area(backer!.outer)).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.id === 'gap-hollow')).toBe(true);
      expect(result.sheets.length).toBeGreaterThanOrEqual(1);
    }
  });
});
