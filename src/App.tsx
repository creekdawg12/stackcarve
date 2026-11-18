import { useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { ActionsProvider, useActions } from './actions';
import { DesignProvider } from './design/DesignContext';
import { PlanProvider, usePlan } from './plan/PlanContext';
import { piecesText, rangeText, sizeText } from './plan/format';
import { sourceReady } from './engine/generate';
import { cancelAi } from './relief/ai';
import { useNextAction } from './components/nextAction';
import { PlanPanel } from './components/panels/PlanPanel';
import { SourcePanel } from './components/panels/SourcePanel';
import { SlicesPanel } from './components/panels/SlicesPanel';
import { SheetsPanel } from './components/panels/SheetsPanel';
import { PlanSheet } from './components/PlanSheet';
import { ModelViewport } from './components/ModelViewport';
import { DesignStage } from './components/DesignStage';
import { SlicesViewport } from './components/SlicesViewport';
import { SheetsView } from './components/SheetsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { AppStep } from './types';

const STEP_ORDER: AppStep[] = ['plan', 'source', 'slices', 'sheets'];

/** The four steps across the top. Any step can be opened at any time; ticks show what is done. */
function StepNav() {
  const { step, settings, mesh, reliefBase, result, stale, dispatch } = useStore();
  const photo = settings.inputMode === 'relief';
  const ready = sourceReady({ settings, mesh, reliefBase });
  const fresh = !!result && !stale;
  const labels: Record<AppStep, string> = { plan: 'Plan', source: photo ? 'Design' : 'Model', slices: 'Slices', sheets: 'Sheets' };
  const done: Record<AppStep, boolean> = { plan: ready || !!result, source: ready, slices: fresh, sheets: false };
  return <nav className="steps" aria-label="Steps">
    {STEP_ORDER.map((id, i) => <button key={id} type="button" className={`${step === id ? 'active' : ''} ${done[id] ? 'done' : ''}`} aria-current={step === id ? 'step' : undefined} onClick={() => dispatch({ type: 'step', value: id })}>
      <span className="step-no" aria-hidden="true">{done[id] && step !== id ? <svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.6 11.5 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg> : i + 1}</span>
      <span className="step-label">{labels[id]}</span>
    </button>)}
  </nav>;
}

/** Project name, Save, and a small menu for opening or starting a project. */
function ProjectMenu() {
  const { projectName, dispatch } = useStore();
  const { saveProject, pickProject, newProject } = useActions();
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return <div className="project" ref={host}>
    <input className="project-name" value={projectName} onChange={e => dispatch({ type: 'name', value: e.target.value })} aria-label="Project name" spellCheck={false}/>
    <button type="button" className="btn save" onClick={saveProject}>Save</button>
    <button type="button" className="btn icon" aria-haspopup="menu" aria-expanded={open} aria-label="Project menu" onClick={() => setOpen(o => !o)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="16" cy="10" r="1.7"/></svg>
    </button>
    {open && <div className="menu" role="menu">
      <label className="menu-name"><span>Project name</span><input value={projectName} onChange={e => dispatch({ type: 'name', value: e.target.value })} spellCheck={false}/></label>
      <button type="button" role="menuitem" onClick={run(saveProject)}><b>Save project</b><small>Downloads a file with the photo, depth and settings</small></button>
      <button type="button" role="menuitem" onClick={run(pickProject)}><b>Open a project</b><small>Pick a saved .stackcarve.json file</small></button>
      <button type="button" role="menuitem" onClick={run(newProject)}><b>New project</b><small>Clear the photo and start a fresh plan</small></button>
    </div>}
  </div>;
}

/** Things that need a decision before carrying on: a session to restore, or work not yet saved. */
function Notices() {
  const { reliefBase, unsavedAi } = useStore();
  const { restorable, restoreSession, discardSession, saveProject } = useActions();
  if (restorable && !reliefBase) {
    const when = new Date(restorable.savedAt).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
    return <div className="notice restore" role="status">
      <span>Your photo session from {when} is still here, with its depth{restorable.relief?.mask ? ' and cutout' : ''}.</span>
      <button type="button" className="btn" onClick={() => { void restoreSession(); }}>Restore it</button>
      <button type="button" className="btn quiet" onClick={discardSession}>Discard</button>
    </div>;
  }
  if (unsavedAi) {
    return <div className="notice" role="status">
      <span>The depth and cutout live only in this browser until you save the project.</span>
      <button type="button" className="btn" onClick={saveProject}>Save now</button>
    </div>;
  }
  return null;
}

/** What the plan comes to in one line: pencil while it is an estimate, plain once generated. */
function Tally() {
  const { plan } = usePlan();
  const estimate = plan.basis !== 'actual';
  return <div className={estimate ? 'tally pencil' : 'tally'} title={estimate ? 'Estimate' : 'As generated'}>
    <b>{piecesText(plan)}</b>
    <span>{sizeText(plan)}</span>
    <span>{rangeText(plan.sheets)} {plan.sheets.high === 1 ? 'sheet' : 'sheets'}</span>
  </div>;
}

/** Pinned under the panel: the plan's tally and the one button that moves the job forward. */
function ActionBar() {
  const { primary, secondary } = useNextAction();
  return <div className="action-bar">
    <Tally/>
    <button type="button" className="btn primary" onClick={primary.run}>{primary.label}</button>
    {secondary && <button type="button" className="link centre" onClick={secondary.run}>{secondary.label}</button>}
  </div>;
}

function Workspace() {
  const { step, dispatch, busy, progress, status, result, stale, selectedLayer, selectedPartId, unsavedAi } = useStore();
  const actions = useActions();
  const { primary } = useNextAction();
  // Phones: the step's controls live in a drawer; the bottom bar keeps the next action in reach.
  const [drawer, setDrawer] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { setDrawer(false); }, [step]);
  useEffect(() => {
    if (!unsavedAi) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [unsavedAi]);

  const selected = result?.layers.flatMap(l => l.parts).find(p => p.id === selectedPartId);
  const toCheck = (result?.warnings ?? []).filter(w => w.severity !== 'info').length;
  const openChecks = () => { dispatch({ type: 'step', value: 'slices' }); setTimeout(() => setDrawer(true), 0); };
  const problem = /failed|cannot|first\b|too |more than|not a /i.test(status);

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">SC</span><b>StackCarve</b></div>
      <StepNav/>
      <ProjectMenu/>
    </header>
    <Notices/>
    <main className={`work step-${step}`}>
      <aside className={drawer ? 'panel open' : 'panel'} aria-label="Settings for this step">
        <div className="panel-scroll">
          {step === 'plan' && <PlanPanel/>}
          {step === 'source' && <SourcePanel/>}
          {step === 'slices' && <SlicesPanel/>}
          {step === 'sheets' && <SheetsPanel/>}
        </div>
        <ActionBar/>
      </aside>
      <section className={dragging ? 'stage dropping' : 'stage'}
        onDragOver={e => { const types = e.dataTransfer?.types ?? []; if (types.includes('Files') || types.includes('text/uri-list')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); actions.loadDropped(e.dataTransfer); }}>
        {step === 'plan' && <PlanSheet/>}
        {step === 'source' && <SourceStage/>}
        {step === 'slices' && <SlicesViewport/>}
        {step === 'sheets' && <SheetsView/>}
        {stale && result && (step === 'slices' || step === 'sheets') && <div className="stale-banner" role="status"><span>Settings changed since this was generated.</span><button type="button" className="btn primary" onClick={() => { void actions.generate(); }}>Regenerate</button></div>}
        {busy && <div className="busy-overlay" role="alert" aria-live="polite"><div className="spinner"/><b>{busy}</b><span>{status}</span><div className="progress"><i style={{ width: `${Math.max(2, progress)}%` }}/></div>
          {/depth|cutting out|judging/i.test(busy) && <button type="button" className="btn" onClick={() => { cancelAi(); dispatch({ type: 'busy', label: null, status: 'Cancelled.' }); }}>Cancel</button>}</div>}
        <div className={problem ? 'statusbar problem' : 'statusbar'}>
          <span title={status}>{status}</span>
          <div className="status-right">
            {selected && <b>Part {selected.label}, layer {selectedLayer + 1}</b>}
            {toCheck > 0 && step !== 'slices' && <button type="button" className="pill hot" onClick={openChecks}>{toCheck} to check</button>}
          </div>
        </div>
      </section>
    </main>
    <div className={step === 'plan' ? 'mobile-bar solo' : 'mobile-bar'}>
      <Tally/>
      {step !== 'plan' && <button type="button" className={drawer ? 'btn active' : 'btn'} onClick={() => setDrawer(o => !o)}>{drawer ? 'Close' : 'Settings'}</button>}
      <button type="button" className="btn primary" onClick={primary.run}>{primary.label}</button>
    </div>
  </div>;
}

/** Step two shows the design bench (pictures in, one chosen) or the 3D model, whichever the plan is made from. */
function SourceStage() {
  const { settings } = useStore();
  return settings.inputMode === 'relief' ? <DesignStage/> : <ModelViewport/>;
}

export function App() {
  return <ErrorBoundary><StoreProvider><DesignProvider><ActionsProvider><PlanProvider><Workspace/></PlanProvider></ActionsProvider></DesignProvider></StoreProvider></ErrorBoundary>;
}
