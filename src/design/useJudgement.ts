import { useMemo } from 'react';
import { useStore } from '../store';
import { usePlan } from '../plan/PlanContext';
import { effectiveMode } from '../plan/plan';
import { renderAnglePreview, renderFrontPreview, type FrontPreview } from '../plan/preview';
import type { ProjectSettings } from '../types';
import { useDesign } from './DesignContext';
import { judgeField, judgePicture, type Judgement } from './judge';
import type { Picture } from './types';

/** The brief as a photo build, which is what every picture in the tray would become. */
export function photoBrief(settings: ProjectSettings): ProjectSettings {
  return settings.inputMode === 'relief' ? settings : { ...settings, inputMode: 'relief' };
}

/**
 * How a picture carves at the current brief. The picture in use is judged on the bench's own
 * depth and wall plane, so its tile always agrees with the plan sheet; the rest are judged with
 * a wall plane fitted to each.
 */
export function useJudgement(picture: Picture | null): Judgement | null {
  const { settings } = useStore();
  const { activeId } = useDesign();
  const { field } = usePlan();
  return useMemo(() => {
    if (!picture?.depth) return null;
    const brief = photoBrief(settings);
    if (picture.id === activeId && field.kind === 'photo' && settings.inputMode === 'relief') return judgeField(brief, field);
    return judgePicture(picture, brief);
  }, [picture, activeId, field, settings]);
}

/** The picture drawn as the slicer would cut it: angled for slab builds when asked, otherwise from the front. */
export function useCutPreview(judgement: Judgement | null, maxPx: number, angled: boolean): FrontPreview | null {
  const { settings } = useStore();
  return useMemo(() => {
    if (!judgement) return null;
    const brief = photoBrief(settings);
    return angled && effectiveMode(brief) === 'slabs' ? renderAnglePreview(brief, judgement.field, maxPx) : renderFrontPreview(brief, judgement.field, maxPx);
  }, [judgement, settings, maxPx, angled]);
}
