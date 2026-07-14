export function NumberField({ label, value, onChange, min, max, step = 0.01, suffix = 'in' }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  return <label className="field number-field">
    <span>{label}</span>
    <span className="input-wrap"><input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}/><small>{suffix}</small></span>
  </label>;
}
