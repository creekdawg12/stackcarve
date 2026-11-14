import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { AppStep, MeshModel, PipelineResult, ProjectSettings, ReliefBase, SourceAsset, StackCarveProject } from './types';
import { START_SETTINGS } from './presets';
import { mergeSettings } from './export/project';

interface State {
  /** Which of the four steps is on screen. */
  step: AppStep;
  projectName: string;
  settings: ProjectSettings;
  sourceAsset: SourceAsset | null;
  mesh: MeshModel | null;
  /** Raw photo depth (brightness or AI) before the curve. */
  reliefBase: ReliefBase | null;
  /** Cutout mask at the base's size, 0 = background. Null = no mask (use the threshold). */
  mask: Uint8Array | null;
  result: PipelineResult | null;
  selectedLayer: number;
  selectedPartId: string | null;
  busy: string | null;
  progress: number;
  status: string;
  /** True when AI depth or a mask exists that has not been written to a project file yet. */
  unsavedAi: boolean;
  /** True when settings changed after the result was generated; the result stays on screen until regenerated. */
  stale: boolean;
}

type Action =
  | { type: 'step'; value: AppStep }
  | { type: 'name'; value: string }
  | { type: 'settings'; value: Partial<ProjectSettings> }
  /** Merge into the photo settings as they are now, safe to call after an await. */
  | { type: 'relief'; value: Partial<ProjectSettings['relief']> }
  | { type: 'source'; asset: SourceAsset | null; mesh?: MeshModel | null }
  | { type: 'mesh'; mesh: MeshModel | null }
  | { type: 'reliefBase'; base: ReliefBase | null; mask?: Uint8Array | null }
  | { type: 'mask'; mask: Uint8Array | null }
  | { type: 'result'; result: PipelineResult | null }
  | { type: 'selectLayer'; index: number }
  | { type: 'selectPart'; id: string | null }
  | { type: 'busy'; label: string | null; progress?: number; status?: string }
  | { type: 'project'; project: StackCarveProject }
  | { type: 'saved' }
  | { type: 'reset' };

export const BRIEF_KEY = 'stackcarve.brief.v1';
const DEFAULT_NAME = 'wall-art';
const WELCOME = 'Start with the plan: what you are making, how big, and from what stock.';

/** The last brief used in this browser, so the app reopens on your stock and sizes instead of generic ones. */
function loadBrief(): { name: string; settings: ProjectSettings } | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BRIEF_KEY) : null;
    if (!raw) return null;
    const data = JSON.parse(raw) as { name?: string; settings?: Partial<ProjectSettings> };
    if (!data.settings) return null;
    return { name: data.name || DEFAULT_NAME, settings: mergeSettings(data.settings) };
  } catch { return null; }
}

function freshState(): State {
  return {
    step: 'plan',
    projectName: DEFAULT_NAME,
    settings: START_SETTINGS,
    sourceAsset: null,
    mesh: null,
    reliefBase: null,
    mask: null,
    result: null,
    selectedLayer: 0,
    selectedPartId: null,
    busy: null,
    progress: 0,
    status: WELCOME,
    unsavedAi: false,
    stale: false
  };
}

function initialState(): State {
  const brief = loadBrief();
  return brief ? { ...freshState(), projectName: brief.name, settings: brief.settings } : freshState();
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'step': return { ...state, step: action.value };
    case 'name': return { ...state, projectName: action.value };
    // Tweaks keep the last result on screen, flagged stale, so the view does not blank on every keystroke.
    case 'settings': return { ...state, settings: { ...state.settings, ...action.value }, stale: !!state.result };
    case 'relief': return { ...state, settings: { ...state.settings, relief: { ...state.settings.relief, ...action.value } }, stale: !!state.result };
    // A new source model or photo makes the old geometry meaningless.
    case 'source': return { ...state, sourceAsset: action.asset, mesh: action.mesh ?? state.mesh, result: null, stale: false };
    case 'mesh': return { ...state, mesh: action.mesh, result: null, stale: false };
    case 'reliefBase': return { ...state, reliefBase: action.base, mask: action.mask === undefined ? state.mask : action.mask, stale: !!state.result, unsavedAi: state.unsavedAi || action.base?.source === 'depth' };
    case 'mask': return { ...state, mask: action.mask, stale: !!state.result, unsavedAi: state.unsavedAi || !!action.mask };
    case 'result': return { ...state, result: action.result, stale: false, selectedLayer: 0, selectedPartId: null };
    case 'selectLayer': return { ...state, selectedLayer: action.index };
    case 'selectPart': return { ...state, selectedPartId: action.id };
    case 'busy': return { ...state, busy: action.label, progress: action.progress ?? state.progress, status: action.status ?? state.status };
    case 'project': return { ...state, projectName: action.project.name || state.projectName, settings: action.project.settings, sourceAsset: action.project.sourceAsset, mesh: null, reliefBase: null, mask: null, result: null, stale: false, status: 'Project opened.', unsavedAi: false };
    case 'saved': return { ...state, unsavedAi: false };
    case 'reset': return { ...freshState(), status: 'New project. Start with the plan.' };
    default: return state;
  }
}

interface StoreValue extends State {
  dispatch: React.Dispatch<Action>;
  patchSettings: (patch: Partial<ProjectSettings>) => void;
}

const Store = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const value = useMemo(() => ({
    ...state,
    dispatch,
    patchSettings: (patch: Partial<ProjectSettings>) => dispatch({ type: 'settings', value: patch })
  }), [state]);

  // Remember the brief (small: settings and name only) a moment after it changes.
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(BRIEF_KEY, JSON.stringify({ name: state.projectName, settings: state.settings })); } catch { /* storage full or blocked */ }
    }, 400);
    return () => clearTimeout(id);
  }, [state.projectName, state.settings]);

  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useStore() {
  const value = useContext(Store);
  if (!value) throw new Error('useStore must be inside StoreProvider');
  return value;
}
