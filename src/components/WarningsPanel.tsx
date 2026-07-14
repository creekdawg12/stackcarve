import { useStore } from '../store';

export function WarningsPanel() {
  const { result, dispatch } = useStore();
  const warnings = result?.warnings ?? [];
  return <section className="warnings-panel">
    <div className="panel-title"><span>Live warnings</span><b>{warnings.length}</b></div>
    <div className="warnings-list">
      {!warnings.length && <div className="warning empty">No active manufacturing warnings.</div>}
      {warnings.slice(0, 50).map(w => <button key={w.id} className={`warning ${w.severity}`} onClick={() => {
        if (w.layerIndex != null) dispatch({ type: 'selectLayer', index: w.layerIndex });
        if (w.partId) dispatch({ type: 'selectPart', id: w.partId });
      }}><i/><span>{w.message}</span></button>)}
    </div>
  </section>;
}
