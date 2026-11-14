import { useStore } from '../store';
import { useActions } from '../actions';
import { sourceReady } from '../engine/generate';
import { aiSupported } from '../relief/ai';
import type { AppStep } from '../types';

export interface NextAction { label: string; run: () => void }

/**
 * The one thing to do next, wherever you are. The main button always carries it, so the flow
 * from plan to cut files never needs hunting for.
 */
export function useNextAction(): { primary: NextAction; secondary: NextAction | null } {
  const { step, settings, mesh, reliefBase, mask, result, stale, dispatch } = useStore();
  const actions = useActions();
  const photo = settings.inputMode === 'relief';
  const ready = sourceReady({ settings, mesh, reliefBase });
  const fresh = !!result && !stale;
  const go = (value: AppStep) => () => dispatch({ type: 'step', value });
  const generate: NextAction = { label: result ? 'Regenerate slices' : 'Generate slices', run: () => { void actions.generate(); } };

  if (!ready) {
    if (step === 'source') return { primary: { label: photo ? 'Choose a photo' : 'Choose a 3D model', run: photo ? actions.pickPhoto : actions.pickMesh }, secondary: null };
    return { primary: { label: photo ? 'Next: add your photo' : 'Next: add your 3D model', run: go('source') }, secondary: null };
  }
  if (fresh) {
    if (step === 'sheets') return { primary: { label: 'Download cut files', run: actions.exportZip }, secondary: null };
    if (step === 'slices') return { primary: { label: 'Next: cut sheets', run: go('sheets') }, secondary: null };
    return { primary: { label: 'View the slices', run: go('slices') }, secondary: null };
  }
  // A photo works best with depth and a cutout; lead through them, but never block generating.
  if (step === 'source' && photo && reliefBase && aiSupported()) {
    const skip: NextAction = { label: 'Generate without it', run: generate.run };
    if (reliefBase.source !== 'depth') return { primary: { label: 'Estimate depth', run: () => { void actions.runDepth(); } }, secondary: skip };
    if (!mask) return { primary: { label: 'Cut out the subject', run: () => { void actions.runCutout(); } }, secondary: skip };
  }
  return { primary: generate, secondary: null };
}
