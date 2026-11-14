import type { ProjectSettings } from '../types';

/** Pixel bounds (inclusive) of everything that counts as the subject in a composed heightmap. */
export interface SubjectBox { x0: number; x1: number; y0: number; y1: number; cols: number; rows: number }

export function subjectBox(values: ArrayLike<number>, width: number, height: number, threshold: number): SubjectBox | null {
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (values[row + x] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x0, x1, y0, y1, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

/**
 * Width of the whole photo frame, in inches, that puts the subject at the size the user asked for.
 * The slicer scales by frame width; people think in the width of the piece on the wall.
 */
export function frameWidthFor(relief: ProjectSettings['relief'], box: SubjectBox | null, width: number): number {
  if (relief.sizeTo !== 'subject' || !box) return relief.finishedWidth;
  // A subject thinner than a twentieth of the frame is a stray speck, not something to size by.
  if (box.cols < width * 0.05) return relief.finishedWidth;
  return relief.finishedWidth * Math.max(1, width - 1) / box.cols;
}

/** Settings as the slicer needs them: finishedWidth resolved to the frame width. */
export function resolveReliefSizing(settings: ProjectSettings, map: { values: ArrayLike<number>; width: number; height: number }): ProjectSettings {
  if (settings.inputMode !== 'relief' || settings.relief.sizeTo !== 'subject') return settings;
  const box = subjectBox(map.values, map.width, map.height, settings.relief.backgroundThreshold);
  const finishedWidth = frameWidthFor(settings.relief, box, map.width);
  if (Math.abs(finishedWidth - settings.relief.finishedWidth) < 1e-9) return settings;
  return { ...settings, relief: { ...settings.relief, finishedWidth } };
}
