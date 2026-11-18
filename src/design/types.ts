import type { ReliefBase } from '../types';

/**
 * One candidate picture in the Design step: something pasted from ChatGPT, one take split off a
 * sheet, or a photo. It carries its own depth and cutout, so pictures can be judged side by side
 * and the chosen one handed to the slicer without redoing anything.
 */
export interface Picture {
  id: string;
  /** Shown under the tile: "Top left", "bulldog.jpg". */
  name: string;
  /** Where the picture sat on its sheet, for the follow-up to ChatGPT. Null for a picture that came alone. */
  position: string | null;
  /** The picture itself, cropped to its subject, as a data URL. */
  dataUrl: string;
  mimeType: string;
  /** The working grid depth and cutout are kept on (512 on the long side at most). */
  width: number;
  height: number;
  /** Depth from the model, 1 = closest. Null until the picture has been judged. */
  depth: ReliefBase | null;
  /** Cutout on the working grid, 0 = background. Null when the picture has none yet. */
  mask: Uint8Array | null;
  /** How the cutout was made: from transparency, from a plain background, or with the cutout tools. */
  maskFrom: 'transparent' | 'plain' | 'tool' | null;
  state: 'new' | 'judging' | 'ready' | 'failed';
  error?: string;
  addedAt: number;
}

/** Most pictures the tray holds; beyond this the oldest unused ones would only be clutter. */
export const TRAY_LIMIT = 12;
