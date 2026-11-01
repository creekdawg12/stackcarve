import { useEffect, useState } from 'react';

/**
 * Numeric input that lets you type freely ("0.25", ".5", "3/8") and commits on blur or Enter.
 * Committing clamps to min/max. Simple fractions are accepted and converted to decimals.
 */
export function NumberField({ label, value, onChange, min, max, step = 0.01, suffix = 'in' }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  const format = (n: number) => Number.isFinite(n) ? String(Number(n.toFixed(4))) : '';
  const [text, setText] = useState(format(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (!editing) setText(format(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = parse(text);
    if (parsed == null) { setText(format(value)); return; }
    let n = parsed;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    setText(format(n));
    if (Math.abs(n - value) > 1e-9) onChange(n);
  };

  return <label className="field number-field">
    <span>{label}</span>
    <span className="input-wrap"><input type="text" inputMode="decimal" value={text} step={step}
      onFocus={() => setEditing(true)}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(format(value)); setEditing(false); (e.target as HTMLInputElement).blur(); } }}/><small>{suffix}</small></span>
  </label>;
}

function parse(text: string): number | null {
  const t = text.trim().replace(/in$/i, '').trim();
  if (!t) return null;
  const mixed = t.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) { const d = Number(mixed[3]); return d ? Number(mixed[1]) + Math.sign(Number(mixed[1]) || 1) * Number(mixed[2]) / d : null; }
  const frac = t.match(/^(-?\d+)\/(\d+)$/);
  if (frac) { const d = Number(frac[2]); return d ? Number(frac[1]) / d : null; }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
