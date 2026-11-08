import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../defaults';
import { estimateBuild } from '../engine/estimate';
import { PRESETS } from '../components/ControlPanel';
import type { ProjectSettings, ReliefBase } from '../types';

const preset = (id: string, s: ProjectSettings): ProjectSettings => ({ ...s, ...PRESETS.find(p => p.id === id)!.apply(s) });

function fakeBase(width: number, height: number): ReliefBase {
  return { source: 'luminance', width, height, values: new Float32Array(width * height).fill(0.5) };
}

describe('build estimate shown before generation', () => {
  it('counts vertical photo slabs across the finished width, gap included', () => {
    const s = preset('lineart', { ...DEFAULT_SETTINGS, inputMode: 'relief' });
    const est = estimateBuild(s, null, fakeBase(400, 320));
    expect(est.mode).toBe('slabs');
    expect(est.pitch).toBeCloseTo(0.5);
    // 20 in wide at 0.25 in stock with 0.25 in gaps: (20 + 0.25) / 0.5 rounds to 41
    expect(est.count).toBe(41);
    expect(est.exact).toBe(false);
    expect(est.stackExtent).toBeCloseTo(41 * 0.5 - 0.25);
    expect(est.reliefHeight).toBeCloseTo(20 * 319 / 399);
  });

  it('uses the photo height for horizontal slabs', () => {
    const s = preset('stack', { ...DEFAULT_SETTINGS, inputMode: 'relief' });
    const est = estimateBuild(s, null, fakeBase(400, 320));
    expect(s.wallArt.slabDirection).toBe('horizontal');
    expect(est.count).toBe(Math.round(est.reliefHeight / 0.25));
  });

  it('terraced photo relief divides depth by thickness', () => {
    const s = preset('plaque', { ...DEFAULT_SETTINGS, inputMode: 'relief' });
    const est = estimateBuild(s, null, fakeBase(100, 100));
    expect(est.mode).toBe('terraced');
    expect(est.count).toBe(10);
    expect(est.exact).toBe(false);
  });

  it('a statue count is exact and needs no mesh to estimate', () => {
    const s = preset('statue', DEFAULT_SETTINGS);
    const est = estimateBuild(s, null, null);
    expect(est.mode).toBe('statue');
    expect(est.count).toBe(16);
    expect(est.exact).toBe(true);
    expect(est.scaled).toBeNull();
  });
});
