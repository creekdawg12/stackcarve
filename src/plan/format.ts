import { MATERIALS } from '../defaults';
import type { ProjectSettings } from '../types';
import { fraction, type Plan, type SheetRange } from './plan';

/** 19.75 → "19.8"; whole numbers stay whole. */
export const num = (n: number, digits = 1) => String(Number(n.toFixed(digits)));

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1", or "2 to 3" when the estimate straddles a sheet boundary. */
export function rangeText(r: SheetRange): string {
  return r.low === r.high ? String(r.likely) : `${r.low} to ${r.high}`;
}

export function piecesText(plan: Plan): string {
  return plural(plan.pieces, plan.pieceWord);
}

/** Width × height × depth, in the order you would measure the piece on the wall. */
export function sizeText(plan: Plan): string {
  const { width, height, depth } = plan.size;
  return `${num(width)} × ${num(height)} × ${num(depth, plan.mode === 'statue' ? 1 : 2)} in`;
}

export function weightText(lb: number): string {
  if (lb < 1) return 'under 1 lb';
  return `${lb < 10 ? num(lb, 1) : Math.round(lb)} lb`;
}

export function feetText(inches: number): string {
  const ft = inches / 12;
  return `${ft < 20 ? num(ft, 1) : Math.round(ft)} ft`;
}

export function stockLabel(settings: ProjectSettings): string {
  return `${fraction(settings.materialThickness)} in ${MATERIALS[settings.plan.material]?.label ?? 'stock'}`;
}

export function basisLabel(plan: Plan): string {
  if (plan.basis === 'actual') return 'As generated';
  if (plan.basis === 'source') return plan.photo ? 'Estimated from your photo' : 'Estimated from your model';
  return plan.photo ? 'Rough, for a typical portrait' : 'Rough, for a typical model';
}

/** The hardware line of the quantities table. */
export function hardwareText(plan: Plan): { label: string; value: string; detail?: string } {
  const h = plan.hardware;
  if (h.kind === 'rods') {
    if (!h.count) return { label: 'Rods', value: 'none', detail: 'Glue against a straight board' };
    return {
      label: 'Rods',
      value: `${h.count} × ${num(h.length)} in`,
      detail: `${fraction(h.hole)} in holes${h.spacers ? `, ${h.spacers} spacers ${fraction(h.spacerLength)} in long` : ''}`
    };
  }
  // A statue stacks on long dowels; a plaque is held by short pins. Same holes, different word at the bench.
  const label = plan.mode === 'statue' ? 'Dowels' : 'Pins';
  if (!h.count) return { label, value: 'none', detail: 'Glued only' };
  return {
    label,
    value: `${h.count} × ${num(h.length, 2)} in`,
    detail: `Cut from ${fraction(h.diameter)} in dowel${h.longest > h.length + 1e-6 ? `, longest ${num(h.longest, 2)} in` : ''}`
  };
}
