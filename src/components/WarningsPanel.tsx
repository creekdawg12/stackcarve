import { useState } from 'react';
import { useStore } from '../store';
import type { WarningItem } from '../types';

const ORDER: Record<WarningItem['severity'], number> = { error: 0, warning: 1, info: 2 };
const TITLE: Record<WarningItem['severity'], string> = { error: 'Needs attention', warning: 'Check before cutting', info: 'Notes' };

/** Warnings grouped by severity, errors first; notes are collapsed so the panel stays readable. */
export function WarningsPanel() {
  const { result, dispatch } = useStore();
  const [showInfo, setShowInfo] = useState(false);
  const warnings = [...(result?.warnings ?? [])].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const groups = (['error', 'warning', 'info'] as const).map(sev => ({ sev, items: warnings.filter(w => w.severity === sev) })).filter(g => g.items.length);
  const actionable = warnings.filter(w => w.severity !== 'info').length;

  return <section className="warnings-panel">
    <div className="panel-title"><span>Live warnings</span><b className={actionable ? 'hot' : ''}>{actionable}</b></div>
    <div className="warnings-list">
      {!warnings.length && <div className="warning empty">{result ? 'Nothing to flag. Check the Slices and Sheets tabs, then export.' : 'Generate a project to see manufacturing checks here.'}</div>}
      {groups.map(g => <div key={g.sev} className="warning-group">
        <button className="group-title" onClick={() => g.sev === 'info' && setShowInfo(v => !v)} disabled={g.sev !== 'info'}>
          <span>{TITLE[g.sev]}</span><b>{g.items.length}</b>{g.sev === 'info' && <i>{showInfo ? 'hide' : 'show'}</i>}
        </button>
        {(g.sev !== 'info' || showInfo) && g.items.slice(0, 60).map(w => <button key={w.id} className={`warning ${w.severity}`} onClick={() => {
          if (w.layerIndex != null) dispatch({ type: 'selectLayer', index: w.layerIndex });
          if (w.partId) dispatch({ type: 'selectPart', id: w.partId });
        }}><i/><span>{w.message}</span></button>)}
      </div>)}
    </div>
  </section>;
}
