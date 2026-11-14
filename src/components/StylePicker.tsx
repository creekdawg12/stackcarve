import { STYLES, type StyleId } from '../presets';

/** Small drawings of each style: enough to tell a contour plaque from slabs on edge at a glance. */
function Pictogram({ id }: { id: StyleId }) {
  const a = 26, b = 19, cx = 32, cy = 24;
  const half = (x: number) => b * Math.sqrt(Math.max(0, 1 - ((x - cx) / a) ** 2));
  if (id === 'lineart') {
    const xs = [8, 14, 20, 26, 32, 38, 44, 50, 56];
    return <svg viewBox="0 0 64 48" aria-hidden="true">{xs.map(x => { const h = half(x); return h > 1 ? <rect key={x} x={x - 1.6} y={cy - h} width="3.2" height={2 * h} rx="0.6"/> : null; })}</svg>;
  }
  if (id === 'stack') {
    const xs = Array.from({ length: 13 }, (_, i) => 8 + i * 4);
    return <svg viewBox="0 0 64 48" aria-hidden="true">{xs.map(x => { const h = half(x); return h > 1 ? <rect key={x} x={x - 1.7} y={cy - h} width="3.4" height={2 * h}/> : null; })}</svg>;
  }
  if (id === 'plaque') {
    return <svg viewBox="0 0 64 48" aria-hidden="true">
      <ellipse cx="32" cy="24" rx="26" ry="19" opacity=".45"/>
      <ellipse cx="32" cy="25" rx="19" ry="14" opacity=".65"/>
      <ellipse cx="32" cy="26" rx="12" ry="9" opacity=".85"/>
      <ellipse cx="32" cy="27" rx="5.5" ry="4.5"/>
    </svg>;
  }
  // Statue: a bust built from stacked layers.
  const rows = [7, 10, 11, 11, 10, 8, 6, 9, 15, 19, 21];
  return <svg viewBox="0 0 64 48" aria-hidden="true">{rows.map((w, i) => <rect key={i} x={32 - w} y={3 + i * 3.9} width={2 * w} height="3.1" rx="0.6"/>)}</svg>;
}

export function StylePicker({ value, onChange }: { value: StyleId; onChange: (id: StyleId) => void }) {
  const current = STYLES.find(s => s.id === value);
  return <div className="style-picker">
    <div className="style-grid" role="group" aria-label="Style">
      {STYLES.map(s => <button key={s.id} type="button" className={s.id === value ? 'style-card active' : 'style-card'} aria-pressed={s.id === value} onClick={() => onChange(s.id)}>
        <Pictogram id={s.id}/>
        <span>{s.label}</span>
      </button>)}
    </div>
    {current && <p className="hint">{current.blurb}</p>}
  </div>;
}
