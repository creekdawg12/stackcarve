import { useState } from 'react';
import { StoreProvider, useStore } from './store';
import { ControlPanel } from './components/ControlPanel';
import { ModelViewport } from './components/ModelViewport';
import { SlicesViewport } from './components/SlicesViewport';
import { SheetsView } from './components/SheetsView';
import { WarningsPanel } from './components/WarningsPanel';

function Workspace() {
  const { tab, dispatch, busy, progress, status, result, selectedLayer, selectedPartId } = useStore();
  const [projectName, setProjectName] = useState('stackcarve-project');
  const selected = result?.layers.flatMap(l => l.parts).find(p => p.id === selectedPartId);
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">SC</span><div><b>StackCarve</b><small>Layered CNC sculpture builder</small></div></div>
      <nav>{(['model','slices','sheets'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>dispatch({type:'tab',value:t})}>{t[0].toUpperCase()+t.slice(1)}</button>)}</nav>
      <div className="job-summary">{result?<><span>{result.layers.length} layers</span><span>{result.sheets.length} sheets</span><span>{(result.utilization*100).toFixed(1)}% avg.</span></>:<span>48 × 48 in AltMill workspace</span>}</div>
    </header>
    <main>
      <ControlPanel projectName={projectName} setProjectName={setProjectName}/>
      <section className="workspace">
        {tab==='model'&&<ModelViewport/>}
        {tab==='slices'&&<SlicesViewport/>}
        {tab==='sheets'&&<SheetsView projectName={projectName}/>} 
        {busy&&<div className="busy-overlay"><div className="spinner"/><b>{busy}</b><span>{status}</span><div className="progress"><i style={{width:`${Math.max(2,progress)}%`}}/></div></div>}
        <div className="statusbar"><span>{status}</span>{selected&&<b>Selected {selected.label} · Layer {selectedLayer+1}</b>}</div>
      </section>
      <WarningsPanel/>
    </main>
  </div>;
}

export function App() { return <StoreProvider><Workspace/></StoreProvider>; }
