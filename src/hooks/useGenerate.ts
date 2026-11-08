import { useCallback } from 'react';
import { useStore } from '../store';
import { composeHeightmap } from '../relief/heightmap';
import { runPipeline } from '../engine/pipeline';
import { estimateBuild } from '../engine/estimate';
import { LAYER_SOFT_LIMIT } from '../defaults';

export type GenerateOutcome = 'done' | 'needs-input' | 'cancelled' | 'failed';

/** Counts the pieces a result holds, leaving the backer plate out. */
export function pieceCount(result: { layers: { parts: { role?: string }[] }[] }) {
  return result.layers.filter(l => l.parts.some(p => p.role !== 'backer')).length;
}

/** The Generate action, shared by the control panel and the phone action bar. */
export function useGenerate() {
  const { settings, mesh, reliefBase, mask, dispatch } = useStore();
  return useCallback(async (): Promise<GenerateOutcome> => {
    const est = estimateBuild(settings, mesh, reliefBase);
    if (est.relief && !reliefBase) { dispatch({ type: 'busy', label: null, status: 'Load a photo first (Input section).' }); return 'needs-input'; }
    if (!est.relief && !mesh) { dispatch({ type: 'busy', label: null, status: 'Load a mesh first (Input section).' }); return 'needs-input'; }
    if (est.count > LAYER_SOFT_LIMIT && !window.confirm(`This will generate about ${est.count} pieces. Continue?`)) return 'cancelled';
    dispatch({ type: 'busy', label: 'Generating cut geometry', progress: 10, status: 'Sectioning and rebuilding contours…' });
    try {
      const map = est.relief && reliefBase ? composeHeightmap(reliefBase, { settings: settings.relief, mask, preview: false }) : null;
      // Let the overlay paint before the heavy synchronous geometry pass.
      await new Promise(r => setTimeout(r, 30));
      const output = await runPipeline({ settings, mesh, heightmap: map });
      dispatch({ type: 'result', result: output });
      dispatch({ type: 'tab', value: 'slices' });
      const pieces = pieceCount(output);
      dispatch({ type: 'busy', label: null, progress: 100, status: `Generated ${pieces} ${output.buildMode === 'slabs' ? 'slabs' : 'layers'} on ${output.sheets.length} sheet${output.sheets.length === 1 ? '' : 's'} (${output.stockSheets} × 4×8 stock).` });
      return 'done';
    } catch (e) {
      dispatch({ type: 'busy', label: null, status: e instanceof Error ? e.message : String(e) });
      return 'failed';
    }
  }, [settings, mesh, reliefBase, mask, dispatch]);
}
