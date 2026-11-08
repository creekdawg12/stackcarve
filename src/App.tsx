import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { ControlPanel } from './components/ControlPanel';
import { ModelViewport } from './components/ModelViewport';
import { PhotoWorkbench } from './components/PhotoWorkbench';
import { SlicesViewport } from './components/SlicesViewport';
import { SheetsView } from './components/SheetsView';
import { WarningsPanel } from './components/WarningsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { cancelAi } from './relief/ai';
import { pieceCount, useGenerate } from './hooks/useGenerate';

function Workspace() {
  const { tab, dispatch, busy, progress, status, result, stale, selectedLayer, selectedPartId, settings, unsavedAi } = useStore();
  const photoMode = settings.inputMode === 'relief';
  const generate = useGenerate();
  const [projectName, setProjectName] = useState('stackcarve-project');
  // Narrow screens: the control panel becomes a drawer (phones) and warnings a slide-up sheet (tablets and phones).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => { setSettingsOpen(false); }, [tab]);
  useEffect(() => {
    if (!unsavedAi) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [unsavedAi]);
  const selected = result?.layers.flatMap(l => l.parts).find(p => p.id === selectedPartId);
  const warnings = result?.warnings ?? [];
  const actionable = warnings.filter(w => w.severity !== 'info').length;
  const notesLabel = actionable ? `${actionable} to check` : warnings.length ? `${warnings.length} note${warnings.length === 1 ? '' : 's'}` : 'Notes';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const mobileGenerate = async () => { if (await generate() === 'needs-input') setSettingsOpen(true); };
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">SC</span><div><b>StackCarve</b><small>Layered CNC sculpture builder</small></div></div>
      <nav>{(['model','slices','sheets'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>dispatch({type:'tab',value:t})}>{t==='model'&&photoMode?'Photo':t[0].toUpperCase()+t.slice(1)}</button>)}</nav>
      <div className={stale?'job-summary stale':'job-summary'} title={stale?'Settings changed since this was generated':undefined}>{result?<><span>{plural(pieceCount(result), result.buildMode==='slabs'?'slab':'layer')}</span><span>{plural(result.sheets.length,'sheet')} · {result.stockSheets} × 4×8</span><span>{(result.utilization*100).toFixed(1)}% avg.</span>{result.rods.length>0&&<span>{plural(result.rods.length,'rod')}</span>}{stale&&<span className="stale-tag">stale</span>}</>:<span>48 × 48 in AltMill workspace</span>}</div>
    </header>
    <main>
      <ControlPanel projectName={projectName} setProjectName={setProjectName} open={settingsOpen} onClose={()=>setSettingsOpen(false)}/>
      <section className="workspace">
        {tab==='model'&&(photoMode?<PhotoWorkbench/>:<ModelViewport/>)}
        {tab==='slices'&&<SlicesViewport/>}
        {tab==='sheets'&&<SheetsView projectName={projectName}/>}
        {stale&&result&&tab!=='model'&&<div className="stale-banner" role="status"><span>Settings changed since these were generated.</span><button className="primary" onClick={()=>void generate()}>Regenerate</button></div>}
        {busy&&<div className="busy-overlay"><div className="spinner"/><b>{busy}</b><span>{status}</span><div className="progress"><i style={{width:`${Math.max(2,progress)}%`}}/></div>
          {/depth|cutting out/i.test(busy)&&<button className="cancel" onClick={()=>{cancelAi();dispatch({type:'busy',label:null,status:'Cancelled.'});}}>Cancel</button>}</div>}
        <div className={/failed|cannot|first\b|too |more than/i.test(status)?'statusbar error':'statusbar'}>
          <span title={status}>{status}</span>
          <div className="status-right">{selected&&<b>Selected {selected.label} · Layer {selectedLayer+1}</b>}<button type="button" className={actionable?'notes-btn hot':'notes-btn'} onClick={()=>setNotesOpen(true)} aria-label="Open warnings and notes">{notesLabel}</button></div>
        </div>
      </section>
      <WarningsPanel open={notesOpen} onClose={()=>setNotesOpen(false)}/>
      {notesOpen&&<div className="drawer-backdrop" onClick={()=>setNotesOpen(false)}/>}
    </main>
    <div className="mobile-bar">
      <button type="button" className={settingsOpen?'active':''} onClick={()=>setSettingsOpen(o=>!o)}>{settingsOpen?'Close settings':'Settings'}</button>
      <button type="button" className="primary" onClick={mobileGenerate}>Generate</button>
    </div>
  </div>;
}

export function App() { return <ErrorBoundary><StoreProvider><Workspace/></StoreProvider></ErrorBoundary>; }
