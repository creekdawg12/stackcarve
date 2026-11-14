import { useStore } from '../../store';
import { useActions } from '../../actions';
import { usePlan } from '../../plan/PlanContext';
import { effectiveMode } from '../../plan/plan';
import { num } from '../../plan/format';
import { styleOf } from '../../presets';
import { MATERIALS, SHEET_PRESETS, THICKNESS_PRESETS } from '../../defaults';
import type { MaterialId } from '../../types';
import { NumberField } from '../NumberField';
import { StylePicker } from '../StylePicker';
import { Disclosure, OptionalNumber, Readout, Row, Segmented } from '../ui';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The brief: the handful of decisions that set what gets built and what it takes. */
export function PlanPanel() {
  const { settings, patchSettings } = useStore();
  const { setStyle, setSource } = useActions();
  const { plan } = usePlan();
  const photo = settings.inputMode === 'relief';
  const mode = effectiveMode(settings);
  const style = styleOf(settings);
  const setRelief = (patch: Partial<typeof settings.relief>) => patchSettings({ relief: { ...settings.relief, ...patch } });
  const setWall = (patch: Partial<typeof settings.wallArt>) => patchSettings({ wallArt: { ...settings.wallArt, ...patch } });
  const setPlan = (patch: Partial<typeof settings.plan>) => patchSettings({ plan: { ...settings.plan, ...patch } });
  const t = settings.materialThickness;
  const sheetPreset = SHEET_PRESETS.find(p => near(p.width, settings.sheetWidth) && near(p.height, settings.sheetHeight));
  const rough = plan.basis === 'typical';

  return <div className="step-panel">
    <section className="group">
      <h2>What are you making?</h2>
      <StylePicker value={style} onChange={setStyle}/>
      <Row label="Made from">
        <Segmented label="Made from" value={photo ? 'photo' : 'model'} onChange={setSource}
          options={[{ value: 'photo', label: 'A photo', disabled: style === 'statue', title: style === 'statue' ? 'A statue needs a 3D model' : undefined }, { value: 'model', label: 'A 3D model' }]}/>
      </Row>
    </section>

    <section className="group">
      <h2>{mode === 'statue' ? 'How big?' : 'How big on the wall?'}</h2>
      {photo
        ? <>
          <NumberField label="Width" hint={settings.relief.sizeTo === 'frame' ? 'of the whole photo' : undefined} value={settings.relief.finishedWidth} min={1} onChange={n => setRelief({ finishedWidth: n })}/>
          <Readout label="Height" hint={rough ? 'follows your photo' : 'follows the photo'} value={`${rough ? 'about ' : ''}${num(plan.size.height)} in`}/>
          <NumberField label="Depth off the wall" value={settings.relief.depth} min={0.1} onChange={n => setRelief({ depth: n })}/>
          {settings.relief.sizeTo === 'frame' && <button type="button" className="link" onClick={() => setRelief({ sizeTo: 'subject' })}>Measure the cut-out subject instead of the whole photo</button>}
        </>
        : mode === 'statue'
          ? <>
            <NumberField label="Height" value={settings.targetHeight} min={0.1} onChange={n => patchSettings({ targetHeight: n })}/>
            <Readout label="Footprint" hint={rough ? 'follows your model' : undefined} value={`${rough ? 'about ' : ''}${num(plan.size.width)} × ${num(plan.size.depth)} in`}/>
          </>
          : <>
            <NumberField label="Height of the model" value={settings.targetHeight} min={0.1} onChange={n => patchSettings({ targetHeight: n })}/>
            <NumberField label="Depth off the wall" hint="0 keeps the whole model" value={settings.wallArt.reliefDepth} min={0} onChange={n => setWall({ reliefDepth: n })}/>
            <Readout label="Finished piece" hint={rough ? 'follows your model' : undefined} value={`${rough ? 'about ' : ''}${num(plan.size.width)} × ${num(plan.size.height)} in`}/>
          </>}
    </section>

    <section className="group">
      <h2>What stock?</h2>
      <NumberField label="Thickness" hint="measure it with calipers" value={t} min={0.05} step={0.001} onChange={n => patchSettings({ materialThickness: n })}/>
      <div className="chips" role="group" aria-label="Common thicknesses">
        {THICKNESS_PRESETS.filter(p => p.label !== '23/32').map(p => <button key={p.label} type="button" className={near(t, p.value) ? 'chip active' : 'chip'} aria-pressed={near(t, p.value)} onClick={() => patchSettings({ materialThickness: p.value })}>{p.label}</button>)}
      </div>
      {mode === 'slabs' && <>
        <Row label="Slabs run">
          <Segmented label="Slabs run" value={settings.wallArt.slabDirection} onChange={v => setWall({ slabDirection: v })}
            options={[{ value: 'vertical', label: 'Up and down' }, { value: 'horizontal', label: 'Side to side' }]}/>
        </Row>
        <NumberField label="Gap between slabs" hint="0 for touching" value={settings.wallArt.slabGap} min={0} step={0.0625} onChange={n => setWall({ slabGap: Math.max(0, n) })}/>
      </>}
      <Row label="Sheet size">
        <select aria-label="Sheet size" value={sheetPreset ? sheetPreset.label : 'custom'} onChange={e => { const p = SHEET_PRESETS.find(x => x.label === e.target.value); if (p) patchSettings({ sheetWidth: p.width, sheetHeight: p.height }); }}>
          {SHEET_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
          {!sheetPreset && <option value="custom">{settings.sheetWidth} × {settings.sheetHeight} (custom)</option>}
        </select>
      </Row>
      <OptionalNumber label="4×8 sheets on hand" hint="leave blank for no limit" value={settings.plan.stockOnHand} placeholder="any" min={1} onChange={n => setPlan({ stockOnHand: n == null ? null : Math.round(n) })}/>
      <Disclosure title="Material and cost" summary={`${MATERIALS[settings.plan.material].label}${settings.plan.sheetPrice != null ? `, $${settings.plan.sheetPrice} a sheet` : ''}`}>
        <Row label="Material" hint="sets the weight">
          <select aria-label="Material" value={settings.plan.material} onChange={e => setPlan({ material: e.target.value as MaterialId })}>
            {(Object.keys(MATERIALS) as MaterialId[]).map(id => <option key={id} value={id}>{MATERIALS[id].label}</option>)}
          </select>
        </Row>
        <OptionalNumber label="Price of a 4×8 sheet" value={settings.plan.sheetPrice} placeholder="optional" prefix="$" onChange={n => setPlan({ sheetPrice: n })}/>
      </Disclosure>
    </section>
  </div>;
}
