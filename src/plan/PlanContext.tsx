import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { composeHeightmap, type HeightmapData } from '../relief/heightmap';
import { fieldFromHeightmap, fieldFromMesh, sampleField, type FrontField } from './field';
import { actualPlan, estimatePlan, planNotes, type Plan, type PlanNote } from './plan';

interface PlanValue {
  /** Front view of the subject the estimates and previews are drawn from. */
  field: FrontField;
  /** Estimate from the brief and the field; what-if comparisons are made against this. */
  estimate: Plan;
  /** The plan to show: the generated numbers when they are current, the estimate otherwise. */
  plan: Plan;
  notes: PlanNote[];
  /** The photo's composed depth, shared so the photo bench does not compute it twice. */
  composed: HeightmapData | null;
}

const Ctx = createContext<PlanValue | null>(null);

function useDebounced<T>(value: T, ms: number): T {
  const [held, setHeld] = useState(value);
  useEffect(() => { const id = setTimeout(() => setHeld(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return held;
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { settings, mesh, reliefBase, mask, result, stale } = useStore();
  const photo = settings.inputMode === 'relief';
  const r = settings.relief;

  // Only the settings that shape the depth itself recompute it; size and stock do not.
  const composed = useMemo(
    () => photo && reliefBase ? composeHeightmap(reliefBase, { settings: r, mask, preview: false }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photo, reliefBase, mask, r.invert, r.blackPoint, r.whitePoint, r.gamma, r.blurPx, r.backgroundThreshold, r.depthFloor]
  );

  // Dragging the rotation rings fires many updates; rasterise the model once they settle.
  const rotation = useDebounced(settings.rotationDeg, 180);
  const view = settings.buildMode === 'statue' ? settings.sliceAxis : 'wall';
  const meshField = useMemo(
    () => !photo && mesh ? fieldFromMesh(mesh.geometry, rotation, view) : null,
    [photo, mesh, rotation, view]
  );

  const field = useMemo<FrontField>(() => {
    if (composed) return fieldFromHeightmap(composed, r.backgroundThreshold);
    return meshField ?? sampleField();
  }, [composed, meshField, r.backgroundThreshold]);

  const estimate = useMemo(() => estimatePlan(settings, field), [settings, field]);
  const actual = useMemo(() => result && !stale ? actualPlan(result, settings) : null, [result, stale, settings]);
  const plan = actual ?? estimate;
  const notes = useMemo(() => planNotes(plan, settings, field), [plan, settings, field]);

  const value = useMemo(() => ({ field, estimate, plan, notes, composed }), [field, estimate, plan, notes, composed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlan() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePlan must be inside PlanProvider');
  return value;
}
