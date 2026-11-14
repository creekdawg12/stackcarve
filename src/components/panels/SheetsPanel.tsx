import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { usePlan } from '../../plan/PlanContext';
import { feetText, plural } from '../../plan/format';
import { buildChecklist, checklistText } from '../../export/checklist';
import { SHEET_PRESETS } from '../../defaults';
import { NumberField } from '../NumberField';
import { Disclosure } from '../ui';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function Checklist() {
  const { result, settings } = useStore();
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);
  const items = useMemo(() => result ? buildChecklist(result, settings) : [], [result, settings]);
  if (!result || !items.length) return null;
  const checked = Object.values(done).filter(Boolean).length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(checklistText(items)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  let lastGroup = '';
  return <section className="group checklist">
    <div className="group-head"><h2>Before you cut</h2><span className="count">{checked} of {items.length}</span><button type="button" className="btn small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
    <ol>
      {items.map((it, i) => {
        const head = it.group !== lastGroup ? it.group : null; lastGroup = it.group;
        return <li key={i} className={it.group === 'Fix first' ? 'fix' : ''}>
          {head && <h3>{head}</h3>}
          <label><input type="checkbox" checked={!!done[i]} onChange={e => setDone(d => ({ ...d, [i]: e.target.checked }))}/><span>{it.text}</span></label>
        </li>;
      })}
    </ol>
  </section>;
}

/** Nesting settings, what to buy, and the pre-cut checklist. */
export function SheetsPanel() {
  const { settings, patchSettings, result, stale } = useStore();
  const { plan } = usePlan();
  const actual = plan.basis === 'actual';

  return <div className="step-panel">
    <section className="group">
      <h2>{result ? (stale ? 'Last layout' : 'Cut sheets') : 'No sheets yet'}</h2>
      {result
        ? <dl className="facts">
          <div><dt>Sheets</dt><dd>{plural(result.sheets.length, 'sheet')} of {settings.sheetWidth} × {settings.sheetHeight} in</dd></div>
          <div><dt>To buy</dt><dd>{plural(result.stockSheets, 'sheet')} of 4×8{actual && plan.cost != null ? `, about $${Math.round(plan.cost)}` : ''}</dd></div>
          <div><dt>Sheet use</dt><dd>{(result.utilization * 100).toFixed(0)}% on average</dd></div>
          {actual && plan.cutLength != null && <div><dt>Cutting</dt><dd>{feetText(plan.cutLength)} of cut line</dd></div>}
        </dl>
        : <p className="hint">Generate to nest the parts onto sheets and get the cut files.</p>}
      {stale && result && <p className="hint stale">Settings changed. Regenerate before exporting.</p>}
    </section>

    <Disclosure title="Nesting" summary={`${settings.sheetWidth} × ${settings.sheetHeight} in, ${settings.partGap} in between parts`}>
      <div className="chips" role="group" aria-label="Sheet sizes">
        {SHEET_PRESETS.map(p => <button key={p.label} type="button" className={near(settings.sheetWidth, p.width) && near(settings.sheetHeight, p.height) ? 'chip active' : 'chip'} onClick={() => patchSettings({ sheetWidth: p.width, sheetHeight: p.height })}>{p.label}</button>)}
      </div>
      <NumberField label="Sheet width" value={settings.sheetWidth} min={1} onChange={n => patchSettings({ sheetWidth: n })}/>
      <NumberField label="Sheet height" value={settings.sheetHeight} min={1} onChange={n => patchSettings({ sheetHeight: n })}/>
      <NumberField label="Margin at the edge" value={settings.sheetEdgeMargin} min={0} onChange={n => patchSettings({ sheetEdgeMargin: n })}/>
      <NumberField label="Space between parts" hint="at least your bit diameter" value={settings.partGap} min={0} onChange={n => patchSettings({ partGap: n })}/>
      <label className="toggle"><input type="checkbox" checked={settings.nestInCutouts} onChange={e => patchSettings({ nestInCutouts: e.target.checked })}/><span>Nest small parts inside hollow rings</span></label>
    </Disclosure>

    {!stale && <Checklist/>}
  </div>;
}
