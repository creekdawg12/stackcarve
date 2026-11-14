import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { usePlan } from '../plan/PlanContext';
import { compareRows, effectiveMode, fraction, type CompareKind, type Plan } from '../plan/plan';
import { renderFrontPreview, sectionProfile } from '../plan/preview';
import { basisLabel, feetText, hardwareText, num, piecesText, rangeText, stockLabel, weightText } from '../plan/format';
import { STYLES, styleOf } from '../presets';
import { MATERIALS } from '../defaults';
import { PlanPanel } from './panels/PlanPanel';
import { useNarrow } from './ui';

/** A dimension line with tick marks at both ends and its figure centred on it. */
function Dim({ x1, y1, x2, y2, label, side = 1 }: { x1: number; y1: number; x2: number; y2: number; label: string; side?: 1 | -1 }) {
  const vertical = Math.abs(x1 - x2) < 0.01;
  const tick = 5;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return <g className="dim">
    <line x1={x1} y1={y1} x2={x2} y2={y2}/>
    <line x1={x1 - tick} y1={y1 + tick} x2={x1 + tick} y2={y1 - tick}/>
    <line x1={x2 - tick} y1={y2 + tick} x2={x2 + tick} y2={y2 - tick}/>
    {vertical
      ? <text x={mx - 7 * side} y={my} transform={`rotate(-90 ${mx - 7 * side} ${my})`} textAnchor="middle">{label}</text>
      : <text x={mx} y={my + (side > 0 ? 19 : -8)} textAnchor="middle">{label}</text>}
  </g>;
}

interface Picture { url: string; widthIn: number; heightIn: number }

/** The piece as the chosen style will cut it, rendered once and used by both drawings. */
function usePicture(): Picture | null {
  const { settings } = useStore();
  const { field } = usePlan();
  const preview = useMemo(() => renderFrontPreview(settings, field), [settings, field]);
  return useMemo(() => {
    if (!preview || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = preview.width; canvas.height = preview.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(preview.width, preview.height);
    image.data.set(preview.rgba);
    ctx.putImageData(image, 0, 0);
    return { url: canvas.toDataURL('image/png'), widthIn: preview.widthIn, heightIn: preview.heightIn };
  }, [preview]);
}

/** Front and side views to one scale, with the piece drawn the way the chosen style will cut it. */
function Drawing({ plan, picture }: { plan: Plan; picture: Picture | null }) {
  const { settings } = useStore();
  const { field } = usePlan();
  const section = useMemo(() => sectionProfile(settings, field), [settings, field]);
  if (!picture) return <div className="sheet-empty">Nothing to draw yet. The subject is empty at these settings.</div>;
  const { url } = picture;
  const preview = picture;

  // Lay both views out in one box at one scale, leaving room for the dimension lines.
  const VW = 640, VH = 540, left = 58, top = 34, bottom = 52, right = 24;
  const w = preview.widthIn, h = preview.heightIn;
  // Dimension the depth the plan states, so the drawing and the quantities agree.
  const d = section ? Math.max(section.depthIn, plan.size.depth, 0.01) : 0;
  const between = section ? 64 : 0;
  const scale = Math.min((VW - left - right - between - (section ? 20 : 0)) / (w + d), (VH - top - bottom) / h);
  const fw = w * scale, fh = h * scale, sd = d * scale;
  const used = fw + between + sd;
  const x0 = left + Math.max(0, (VW - left - right - used) / 2), y0 = top + Math.max(0, (VH - top - bottom - fh) / 2);
  const sx = x0 + fw + between;
  const stacked = plan.mode === 'slabs' && settings.wallArt.slabDirection === 'horizontal';

  return <svg className="drawing" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`Front and side views of the piece, ${num(w)} in wide, ${num(h)} in tall${section ? `, ${num(d, 2)} in deep` : ''}`}>
    <defs>
      <pattern id="wall-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6"/></pattern>
    </defs>
    <text className="view-title" x={x0} y={y0 - 12}>FRONT</text>
    <image className="piece-image" href={url} x={x0} y={y0} width={fw} height={fh} preserveAspectRatio="none"/>
    <Dim x1={x0} y1={y0 + fh + 18} x2={x0 + fw} y2={y0 + fh + 18} label={`${num(w)} in`}/>
    <Dim x1={x0 - 20} y1={y0} x2={x0 - 20} y2={y0 + fh} label={`${num(h)} in`}/>
    {section && <g>
      <text className="view-title" x={sx - 10} y={y0 - 12}>SIDE</text>
      <rect className="wall" x={sx - 10} y={y0 - 4} width="10" height={fh + 8} fill="url(#wall-hatch)"/>
      <line className="wall-face" x1={sx} y1={y0 - 4} x2={sx} y2={y0 + fh + 4}/>
      {section.bands.map((b, i) => <rect key={i} className={stacked ? 'profile slab' : 'profile'} x={sx} y={y0 + b.top * scale} width={b.depth * scale} height={Math.max(0.6, (b.bottom - b.top) * scale + (stacked ? 0 : 0.6))}/>)}
      <Dim x1={sx} y1={y0 + fh + 18} x2={sx + sd} y2={y0 + fh + 18} label={`${num(d, 2)} in`}/>
    </g>}
  </svg>;
}

/** The piece next to a person, so 20 inches means something. */
function OnTheWall({ plan, picture }: { plan: Plan; picture: Picture | null }) {
  const statue = plan.mode === 'statue';
  const { width, height } = plan.size;
  // Scene in inches: an 8 ft wall, a 5 ft 8 in figure, the piece centred at eye level (57 in).
  const person = 68, ceiling = 96;
  const tableTop = 30;
  const centre = statue ? tableTop + height / 2 : Math.min(ceiling - height / 2 - 2, Math.max(57, height / 2 + 6));
  const sceneW = Math.max(60, 34 + width + 16);
  const s = 1.3; // px per inch
  const H = ceiling * s + 16, W = sceneW * s;
  const floor = ceiling * s + 4;
  const px = 30 * s, pw = width * s, ph = height * s;
  const py = floor - (centre + height / 2) * s;
  return <figure className="on-wall">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The piece beside a person 5 ft 8 in tall`}>
      <line className="floor" x1="0" y1={floor} x2={W} y2={floor}/>
      {/* A 5 ft 8 in figure, drawn to the same scale as the piece. */}
      <g className="person" transform={`translate(${13 * s} ${floor - person * s}) scale(${s})`}>
        <circle cx="0" cy="4.6" r="4.4"/>
        <path d="M -8.4 14.2 Q -8.4 10.8 -5 10.8 H 5 Q 8.4 10.8 8.4 14.2 V 36 H 6.2 V 68 H 0.8 V 40 H -0.8 V 68 H -6.2 V 36 H -8.4 Z"/>
      </g>
      {statue && <path className="table" d={`M ${px - 8} ${floor} V ${floor - tableTop * s} H ${px + pw + 8} V ${floor}`}/>}
      {picture
        ? <image className="piece-image" href={picture.url} x={px} y={py} width={Math.max(2, pw)} height={Math.max(2, ph)} preserveAspectRatio="none"/>
        : <rect className="piece" x={px} y={py} width={Math.max(2, pw)} height={Math.max(2, ph)} rx="1.5"/>}
    </svg>
    <figcaption>{statue ? 'On a table, beside' : 'At eye level, beside'} a 5 ft 8 in person</figcaption>
  </figure>;
}

function Quantities({ plan }: { plan: Plan }) {
  const { settings } = useStore();
  const hardware = hardwareText(plan);
  const estimate = plan.basis !== 'actual';
  const sheetSize = `${settings.sheetWidth} × ${settings.sheetHeight} in`;
  const rows: { label: string; value: string; detail?: string }[] = [
    { label: 'Pieces', value: piecesText(plan), detail: `${stockLabel(settings)}${plan.gap > 0 ? `, ${fraction(plan.gap)} in gaps` : ''}${plan.extraParts ? ', plus a backer plate' : ''}` },
    { label: 'Finished size', value: `${num(plan.size.width)} × ${num(plan.size.height)} in`, detail: plan.mode === 'statue' ? `${num(plan.size.depth)} in deep` : `${num(plan.size.depth, 2)} in off the wall` },
    { label: 'Sheets to cut', value: rangeText(plan.sheets), detail: estimate && plan.sheets.high === 1 ? `${sheetSize}, about ${Math.max(5, Math.round(plan.sheetLoad * 20) * 5)}% of one` : sheetSize },
    { label: 'Stock to buy', value: `${rangeText(plan.stock)} × 4×8`, detail: plan.cost != null ? `about $${Math.round(plan.cost)}` : undefined },
    hardware,
    { label: 'Weight', value: weightText(plan.weightLb), detail: MATERIALS[settings.plan.material].label }
  ];
  if (plan.cutLength != null) rows.push({ label: 'Cutting', value: feetText(plan.cutLength), detail: 'of cut line, one pass' });
  return <table className={estimate ? 'quantities pencil' : 'quantities'}>
    <caption>{estimate ? 'Estimated quantities' : 'Quantities, as generated'}</caption>
    <tbody>
      {rows.map(r => <tr key={r.label}><th scope="row">{r.label}</th><td><b>{r.value}</b>{r.detail && <small>{r.detail}</small>}</td></tr>)}
    </tbody>
  </table>;
}

function Compare() {
  const { settings, patchSettings } = useStore();
  const { field, plan } = usePlan();
  const slabs = effectiveMode(settings) === 'slabs';
  const [kind, setKind] = useState<CompareKind>('thickness');
  const active: CompareKind = kind === 'gap' && !slabs ? 'thickness' : kind;
  const rows = useMemo(() => compareRows(active, settings, field).map(r =>
    // Once generated, the row in use shows what actually came out rather than its estimate.
    r.selected && plan.basis === 'actual' ? { ...r, pieces: plan.pieces, sheets: plan.sheets, stock: plan.stock, weightLb: plan.weightLb } : r
  ), [active, settings, field, plan]);
  const tabs: { id: CompareKind; label: string }[] = [{ id: 'thickness', label: 'Thickness' }, ...(slabs ? [{ id: 'gap' as const, label: 'Gap' }] : []), { id: 'style', label: 'Style' }];
  return <div className="compare">
    <div className="compare-head">
      <h3>Compare</h3>
      <div className="tabs" role="tablist" aria-label="Compare by">
        {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={active === t.id ? 'active' : ''} onClick={() => setKind(t.id)}>{t.label}</button>)}
      </div>
    </div>
    <table>
      <thead><tr><th scope="col">{active === 'thickness' ? 'Stock' : active === 'gap' ? 'Spacing' : 'Style'}</th><th scope="col">Pieces</th><th scope="col">Sheets</th><th scope="col">Weight</th></tr></thead>
      <tbody>
        {rows.map(r => <tr key={r.key} className={`${r.selected ? 'selected' : ''} ${r.overBudget ? 'over' : ''}`}>
          <th scope="row"><button type="button" aria-pressed={r.selected} onClick={() => { if (!r.selected) patchSettings(r.patch); }}>{r.label}</button></th>
          <td>{r.pieces}</td>
          <td>{rangeText(r.sheets)}{r.overBudget && <span className="over-mark" title="More than the sheets on hand"> over</span>}</td>
          <td>{weightText(r.weightLb)}</td>
        </tr>)}
      </tbody>
    </table>
    <p className="sheet-hint">Tap a row to use it. {active === 'thickness' ? 'Thinner stock shows more detail and takes more pieces.' : active === 'gap' ? 'Wider gaps use less wood and show more wall.' : 'Each style at the size and stock above.'}</p>
  </div>;
}

function Notes() {
  const { patchSettings } = useStore();
  const { notes } = usePlan();
  if (!notes.length) return null;
  return <div className="notes">
    <h3>Notes</h3>
    <ul>
      {notes.map((n, i) => <li key={i} className={n.level}>
        <span className="mark" aria-hidden="true">{n.level === 'ok' ? '✓' : n.level === 'info' ? '•' : '!'}</span>
        <div>
          <p>{n.text}</p>
          {n.fixes && n.fixes.length > 0 && <div className="fixes">{n.fixes.map(f => <button key={f.label} type="button" onClick={() => patchSettings(f.patch)}>{f.label}</button>)}</div>}
        </div>
      </li>)}
    </ul>
  </div>;
}

/**
 * The Plan step: a calc-pad sheet that works the brief out into a drawing, quantities and
 * notes before anything is loaded or cut. Estimates are in pencil; generated numbers in ink.
 */
export function PlanSheet() {
  const { settings, projectName, result, stale } = useStore();
  const { plan } = usePlan();
  const picture = usePicture();
  // On a phone the brief sits above the sheet instead of in a side panel.
  const narrow = useNarrow();
  const style = STYLES.find(s => s.id === styleOf(settings));
  const photo = settings.inputMode === 'relief';
  const generatedAt = result && !stale ? new Date(result.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  return <div className="plan-stage">
    {narrow && <div className="brief-inline"><PlanPanel/></div>}
    <article className={plan.basis === 'actual' ? 'plan-sheet inked' : 'plan-sheet'} aria-label="Project plan">
      <header className="title-block">
        <div><span>Project</span><b>{projectName || 'Untitled'}</b></div>
        <div><span>Build</span><b>{style?.label ?? 'Wall art'} from a {photo ? 'photo' : '3D model'}</b></div>
        <div><span>Basis</span><b>{basisLabel(plan)}{generatedAt ? `, ${generatedAt}` : ''}</b></div>
        <div><span>Stock</span><b>{stockLabel(settings)}, {settings.sheetWidth} × {settings.sheetHeight}</b></div>
      </header>
      <div className="sheet-body">
        <section className="sheet-cell drawing-cell"><Drawing plan={plan} picture={picture}/></section>
        <section className="sheet-cell"><Quantities plan={plan}/></section>
        <section className="sheet-cell notes-cell"><OnTheWall plan={plan} picture={picture}/><Notes/></section>
        <section className="sheet-cell"><Compare/></section>
      </div>
      <footer className="sheet-foot">
        <span>Planned {new Date().toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</span>
        <button type="button" className="sheet-print" onClick={() => window.print()}>Print this plan</button>
      </footer>
    </article>
  </div>;
}
