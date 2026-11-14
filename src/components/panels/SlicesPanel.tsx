import { useState } from 'react';
import { useStore } from '../../store';
import { usePlan } from '../../plan/PlanContext';
import { effectiveMode, fraction } from '../../plan/plan';
import { hardwareText, piecesText, sizeText, weightText } from '../../plan/format';
import type { WarningItem } from '../../types';
import { NumberField } from '../NumberField';
import { Disclosure } from '../ui';

const ORDER: Record<WarningItem['severity'], number> = { error: 0, warning: 1, info: 2 };
const TITLE: Record<WarningItem['severity'], string> = { error: 'Fix before cutting', warning: 'Check before cutting', info: 'Good to know' };

/** Manufacturing checks from the last generation, worst first. Tapping one selects the part it is about. */
export function Checks() {
  const { result, stale, dispatch } = useStore();
  const [showInfo, setShowInfo] = useState(false);
  if (!result) return null;
  const warnings = [...result.warnings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const groups = (['error', 'warning', 'info'] as const).map(sev => ({ sev, items: warnings.filter(w => w.severity === sev) })).filter(g => g.items.length);
  return <div className="checks" aria-label="Checks">
    {stale && <p className="hint stale">From the last generation. Settings have changed since.</p>}
    {!warnings.length && <p className="hint ok">Nothing to flag.</p>}
    {groups.map(g => <div key={g.sev} className={`check-group ${g.sev}`}>
      {g.sev === 'info'
        ? <button type="button" className="check-title" aria-expanded={showInfo} onClick={() => setShowInfo(v => !v)}><span>{TITLE[g.sev]}</span><b>{g.items.length}</b><i>{showInfo ? 'Hide' : 'Show'}</i></button>
        : <div className="check-title"><span>{TITLE[g.sev]}</span><b>{g.items.length}</b></div>}
      {(g.sev !== 'info' || showInfo) && <ul>
        {g.items.slice(0, 60).map(w => <li key={w.id}>
          {w.partId || w.layerIndex != null
            ? <button type="button" onClick={() => { if (w.layerIndex != null) dispatch({ type: 'selectLayer', index: w.layerIndex }); if (w.partId) dispatch({ type: 'selectPart', id: w.partId }); }}>{w.message}</button>
            : <span>{w.message}</span>}
        </li>)}
      </ul>}
    </div>)}
  </div>;
}

/** After generating: what came out, what to check, and the settings that shape the inside of the parts. */
export function SlicesPanel() {
  const { settings, patchSettings, result, stale, dispatch } = useStore();
  const { plan } = usePlan();
  const mode = effectiveMode(settings);
  const photo = settings.inputMode === 'relief';
  const wallArt = mode !== 'statue';
  const setWall = (patch: Partial<typeof settings.wallArt>) => patchSettings({ wallArt: { ...settings.wallArt, ...patch } });
  const hardware = hardwareText(plan);
  const actual = plan.basis === 'actual';

  return <div className="step-panel">
    <section className="group">
      <h2>{result ? (stale ? 'Last result' : 'What came out') : 'Not sliced yet'}</h2>
      {result
        ? <dl className="facts">
          <div><dt>Pieces</dt><dd>{actual ? piecesText(plan) : `${result.layers.filter(l => l.parts.some(p => p.role !== 'backer')).length} ${plan.pieceWord}s`}{actual && plan.extraParts ? ` and a backer` : ''}</dd></div>
          {actual && <div><dt>Size</dt><dd>{sizeText(plan)}</dd></div>}
          {actual && <div><dt>Weight</dt><dd>{weightText(plan.weightLb)}</dd></div>}
          {actual && <div><dt>{hardware.label}</dt><dd>{hardware.value}{hardware.detail && <small>{hardware.detail}</small>}</dd></div>}
        </dl>
        : <p className="hint">Generate to see the piece in 3D. Drag to turn it, pinch to zoom, tap a part to select it.</p>}
      <Checks/>
    </section>

    <Disclosure title="Hollowing" summary={settings.hollowEnabled ? `on, ${settings.wallThickness} in walls` : 'off'}>
      <label className="toggle"><input type="checkbox" checked={settings.hollowEnabled} onChange={e => patchSettings({ hollowEnabled: e.target.checked })}/><span>Cut away the wood nobody will see</span></label>
      {mode === 'slabs' && settings.wallArt.slabGap > 0 && settings.hollowEnabled && <p className="hint">With gaps between slabs, hollow pockets show from the side.</p>}
      <NumberField label="Wall left standing" value={settings.wallThickness} min={0.05} onChange={n => patchSettings({ wallThickness: n })}/>
      <NumberField label="Glue overlap" hint="between neighbours" value={settings.overlapMargin} min={0} onChange={n => patchSettings({ overlapMargin: n })}/>
      <NumberField label={mode === 'terraced' ? 'Solid layers at the wall' : 'Solid layers at the bottom'} value={settings.bottomSolidCaps} min={0} step={1} suffix="" onChange={n => patchSettings({ bottomSolidCaps: Math.round(n) })}/>
      <NumberField label={mode === 'terraced' ? 'Solid layers at the front' : 'Solid layers at the top'} value={settings.topSolidCaps} min={0} step={1} suffix="" onChange={n => patchSettings({ topSolidCaps: Math.round(n) })}/>
    </Disclosure>

    {mode === 'slabs'
      ? <Disclosure title="Rods and back strip" summary={`${fraction(settings.wallArt.rodHoleDiameter)} in holes${settings.wallArt.backerPlate ? ', backer plate' : ''}`}>
        <NumberField label="Rod hole" hint="drill size for your rod" value={settings.wallArt.rodHoleDiameter} min={0.05} step={0.001} onChange={n => setWall({ rodHoleDiameter: n })}/>
        <NumberField label="Hidden strip at the back" hint="holds the rods and numbers" value={settings.wallArt.backZoneDepth} min={0.2} onChange={n => setWall({ backZoneDepth: n })}/>
        {photo && <NumberField label="Depth at the edges" hint="thinnest the piece gets" value={settings.relief.baseDepth} min={0} onChange={n => dispatch({ type: 'relief', value: { baseDepth: n } })}/>}
        <NumberField label="Hole to edge" value={settings.dowelEdgeClearance} min={0} onChange={n => patchSettings({ dowelEdgeClearance: n })}/>
        <label className="toggle"><input type="checkbox" checked={settings.wallArt.backerPlate} onChange={e => setWall({ backerPlate: e.target.checked })}/><span>Add a backer plate to hang it by</span></label>
      </Disclosure>
      : <Disclosure title={wallArt ? 'Pins' : 'Dowels'} summary={`${fraction(settings.dowelDiameter)} in`}>
        <NumberField label={wallArt ? 'Pin diameter' : 'Dowel diameter'} value={settings.dowelDiameter} min={0.05} onChange={n => patchSettings({ dowelDiameter: n })}/>
        <NumberField label="Boss around a hole" hint="added where a layer is thin" value={settings.dowelBossDiameter} min={settings.dowelDiameter} onChange={n => patchSettings({ dowelBossDiameter: n })}/>
        <NumberField label="Hole to edge" value={settings.dowelEdgeClearance} min={0} onChange={n => patchSettings({ dowelEdgeClearance: n })}/>
      </Disclosure>}

    <Disclosure title="Part numbers" summary={`${settings.textHeight} in tall`}>
      <NumberField label="Number height" value={settings.textHeight} min={0.1} onChange={n => patchSettings({ textHeight: n })}/>
      {wallArt && <p className="hint">Numbers are etched only where the next piece covers them. A part with no hidden spot is left blank and listed above.</p>}
    </Disclosure>
  </div>;
}
