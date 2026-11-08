import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { ControlPanel } from './components/ControlPanel';
import { ModelViewport } from './components/ModelViewport';
import { PhotoWorkbench } from './components/PhotoWorkbench';
import { SlicesViewport } from './components/SlicesViewport';
import { SheetsView } from './components/SheetsView';
import { WarningsPanel } from './components/WarningsPanel';
import { cancelAi } from './relief/ai';
import { ErrorBoundary } from './components/ErrorBoundary';

function Workspace() {
  const { tab, dispatch, busy, progress, status, result, selectedLayer, selectedPartId, settings, unsavedAi } = useStore();
  const photoMode = settings.inputMode === 'relief';
  useEffect(() => {
    if (!unsavedAi) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [unsavedAi]);
  const [projectName, setProjectName] = useState('stackcarve-project');
  const selected = result?.layers.flatMap(l => l.parts).find(p => p.id === selectedPartId);
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">SC</span><div><b>StackCarve</b><small>Layered CNC sculpture builder</small></div></div>
      <nav>{(['model','slices','sheets'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>dispatch({type:'tab',value:t})}>{t==='model'&&photoMode?'Photo':t[0].toUpperCase()+t.slice(1)}</button>)}</nav>
      <div className="job-summary">{result?<><span>{result.layers.filter(l=>l.parts.some(p=>p.role!=='backer')).length} {result.buildMode==='slabs'?'slabs':'layers'}</span><span>{result.sheets.length} sheets · {result.stockSheets} × 4×8</span><span>{(result.utilization*100).toFixed(1)}% avg.</span>{result.rods.length>0&&<span>{result.rods.length} rod{result.rods.length===1?'':'s'}</span>}</>:<span>48 × 48 in AltMill workspace</span>}</div>
    </header>
    <main>
      <ControlPanel projectName={projectName} setProjectName={setProjectName}/>
      <section className="workspace">
        {tab==='model'&&(photoMode?<PhotoWorkbench/>:<ModelViewport/>)}
        {tab==='slices'&&<SlicesViewport/>}
        {tab==='sheets'&&<SheetsView projectName={projectName}/>} 
        {busy&&<div className="busy-overlay"><div className="spinner"/><b>{busy}</b><span>{status}</span><div className="progress"><i style={{width:`${Math.max(2,progress)}%`}}/></div>
          {/depth|cutting out/i.test(busy)&&<button className="cancel" onClick={()=>{cancelAi();dispatch({type:'busy',label:null,status:'Cancelled.'});}}>Cancel</button>}</div>}
        <div className={/failed|cannot|first\b|too |more than/i.test(status)?'statusbar error':'statusbar'}><span>{status}</span>{selected&&<b>Selected {selected.label} · Layer {selectedLayer+1}</b>}</div>
      </section>
      <WarningsPanel/>
    </main>
  </div>;
}

export function App() { return <ErrorBoundary><StoreProvider><Workspace/></StoreProvider></ErrorBoundary>; }
