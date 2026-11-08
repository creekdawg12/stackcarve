import React, { createContext, useContext, useMemo, useReducer } from 'react';
import type { AppTab, MeshModel, PipelineResult, ProjectSettings, ReliefBase, SourceAsset, StackCarveProject } from './types';
import { DEFAULT_SETTINGS } from './defaults';

interface State {
  tab: AppTab;
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
  | { type: 'tab'; value: AppTab }
  | { type: 'settings'; value: Partial<ProjectSettings> }
  | { type: 'source'; asset: SourceAsset | null; mesh?: MeshModel | null }
  | { type: 'mesh'; mesh: MeshModel | null }
  | { type: 'reliefBase'; base: ReliefBase | null; mask?: Uint8Array | null }
  | { type: 'mask'; mask: Uint8Array | null }
  | { type: 'result'; result: PipelineResult | null }
  | { type: 'selectLayer'; index: number }
  | { type: 'selectPart'; id: string | null }
  | { type: 'busy'; label: string | null; progress?: number; status?: string }
  | { type: 'project'; project: StackCarveProject }
  | { type: 'saved' };

const initialState: State = {
  tab: 'model',
  settings: DEFAULT_SETTINGS,
  sourceAsset: null,
  mesh: null,
  reliefBase: null,
  mask: null,
  result: null,
  selectedLayer: 0,
  selectedPartId: null,
  busy: null,
  progress: 0,
  status: 'Load a mesh or photo to begin.',
  unsavedAi: false,
  stale: false
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'tab': return { ...state, tab: action.value };
    // Tweaks keep the last result on screen, flagged stale, so the view does not blank on every keystroke.
    case 'settings': return { ...state, settings: { ...state.settings, ...action.value }, stale: !!state.result };
    // A new source model or photo makes the old geometry meaningless.
    case 'source': return { ...state, sourceAsset: action.asset, mesh: action.mesh ?? state.mesh, result: null, stale: false };
    case 'mesh': return { ...state, mesh: action.mesh, result: null, stale: false };
    case 'reliefBase': return { ...state, reliefBase: action.base, mask: action.mask === undefined ? state.mask : action.mask, stale: !!state.result, unsavedAi: state.unsavedAi || action.base?.source === 'depth' };
    case 'mask': return { ...state, mask: action.mask, stale: !!state.result, unsavedAi: state.unsavedAi || !!action.mask };
    case 'result': return { ...state, result: action.result, stale: false, selectedLayer: 0, selectedPartId: null };
    case 'selectLayer': return { ...state, selectedLayer: action.index };
    case 'selectPart': return { ...state, selectedPartId: action.id };
    case 'busy': return { ...state, busy: action.label, progress: action.progress ?? state.progress, status: action.status ?? state.status };
    case 'project': return { ...state, settings: action.project.settings, sourceAsset: action.project.sourceAsset, result: null, stale: false, status: 'Project settings loaded.', unsavedAi: false };
    case 'saved': return { ...state, unsavedAi: false };
    default: return state;
  }
}

interface StoreValue extends State {
  dispatch: React.Dispatch<Action>;
  patchSettings: (patch: Partial<ProjectSettings>) => void;
}

const Store = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({
    ...state,
    dispatch,
    patchSettings: (patch: Partial<ProjectSettings>) => dispatch({ type: 'settings', value: patch })
  }), [state]);
  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useStore() {
  const value = useContext(Store);
  if (!value) throw new Error('useStore must be inside StoreProvider');
  return value;
}
