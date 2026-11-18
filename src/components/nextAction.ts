import { useStore } from '../store';
import { useActions } from '../actions';
import { useDesign } from '../design/DesignContext';
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
  const design = useDesign();
  const photo = settings.inputMode === 'relief';
  const ready = sourceReady({ settings, mesh, reliefBase });
  const fresh = !!result && !stale;
  const go = (value: AppStep) => () => dispatch({ type: 'step', value });
  const generate: NextAction = { label: result ? 'Regenerate slices' : 'Generate slices', run: () => { void actions.generate(); } };
  const waiting = design.waiting.length;
  const judge: NextAction = { label: waiting === 1 ? 'Judge the picture' : `Judge ${waiting} pictures`, run: () => { void design.judge(); } };
  const pasteIt = (label: string): NextAction => ({ label, run: () => { void design.paste(); } });

  if (!ready) {
    if (step !== 'source') return { primary: { label: photo ? 'Next: design the piece' : 'Next: add your 3D model', run: go('source') }, secondary: null };
    if (!photo) return { primary: { label: 'Choose a 3D model', run: actions.pickMesh }, secondary: null };
    // The Design step: an idea goes out to ChatGPT, pictures come back, the best one gets used.
    if (design.pictures.length) {
      if (waiting) return { primary: judge, secondary: null };
      return { primary: { label: 'Use the top pick', run: () => { void design.useTopPick(); } }, secondary: null };
    }
    if (design.idea.trim()) {
      if (!design.sent) return { primary: { label: 'Open ChatGPT with the prompt', run: design.openChatGpt }, secondary: pasteIt('Paste a picture instead') };
      return { primary: pasteIt('Paste the picture'), secondary: { label: 'Open ChatGPT again', run: design.openChatGpt } };
    }
    return { primary: { label: 'Choose a photo', run: actions.pickPhoto }, secondary: pasteIt('Paste a picture instead') };
  }
  if (fresh) {
    if (step === 'sheets') return { primary: { label: 'Download cut files', run: actions.exportZip }, secondary: null };
    if (step === 'slices') return { primary: { label: 'Next: cut sheets', run: go('sheets') }, secondary: null };
    return { primary: { label: 'View the slices', run: go('slices') }, secondary: null };
  }
  // Pictures still waiting in the tray are judged before moving on, while they are what is on screen.
  if (step === 'source' && photo && design.view === 'pictures' && design.pictures.length > 1 && waiting && aiSupported()) {
    return { primary: judge, secondary: { label: 'Generate from the one in use', run: generate.run } };
  }
  // A photo works best with depth and a cutout; lead through them, but never block generating.
  if (step === 'source' && photo && reliefBase && aiSupported()) {
    const skip: NextAction = { label: 'Generate without it', run: generate.run };
    if (reliefBase.source !== 'depth') return { primary: { label: 'Estimate depth', run: () => { void actions.runDepth(); } }, secondary: skip };
    if (!mask) return { primary: { label: 'Cut out the subject', run: () => { void actions.runCutout(); } }, secondary: skip };
  }
  return { primary: generate, secondary: null };
}
