import { useEffect, useId, useState, type ReactNode } from 'react';

/** A titled group that folds away. Closed, it shows a one-line summary of what is inside. */
export function Disclosure({ title, summary, defaultOpen = false, children }: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <div className={open ? 'fold open' : 'fold'}>
    <button type="button" className="fold-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
      <span className="fold-title">{title}</span>
      {!open && summary && <span className="fold-summary">{summary}</span>}
      <svg className="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open && <div className="fold-body" id={id}>{children}</div>}
  </div>;
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" className={o.value === value ? 'active' : ''} aria-pressed={o.value === value}
      disabled={disabled || o.disabled} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>;
}

/** A row label with its control on the right. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="row">
    <div className="row-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
    <div className="row-control">{children}</div>
  </div>;
}

/** A value the app worked out, shown in the same grid as the inputs. */
export function Readout({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="row readout">
    <div className="row-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
    <div className="row-value">{value}</div>
  </div>;
}

/** Number that may be left blank, for optional planning inputs like sheets on hand. */
export function OptionalNumber({ label, hint, value, onChange, placeholder, prefix, suffix, min = 0 }: {
  label: string; hint?: string; value: number | null; onChange: (n: number | null) => void; placeholder?: string; prefix?: string; suffix?: string; min?: number;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(value == null ? '' : String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const t = text.trim().replace(/^\$/, '');
    if (!t) { if (value != null) onChange(null); return; }
    const n = Number(t);
    if (!Number.isFinite(n)) { setText(value == null ? '' : String(value)); return; }
    const clamped = Math.max(min, n);
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return <label className="row">
    <div className="row-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
    <span className="input-wrap">{prefix && <small className="prefix">{prefix}</small>}
      <input type="text" inputMode="decimal" value={text} placeholder={placeholder}
        onFocus={() => setEditing(true)} onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}/>
      {suffix && <small>{suffix}</small>}</span>
  </label>;
}

/** True while the window is narrow enough that the step panel becomes a drawer. */
export function useNarrow(query = '(max-width: 760px)') {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
