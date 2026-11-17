// Preset choice for the edit page's inline preview. Downloading with
// progress, and the full-screen preset choice, are shared with the public
// gallery's overlay (shared/overlay/progress.ts).

import { pickByWidth } from "@shared/overlay/progress";
import { PREVIEW_CANDIDATES, type PresetName } from "./images";

export {
  OVERLAY_BOX_WIDTH_RATIO,
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "@shared/overlay/progress";

/** Preview presets with their pixel width, smallest first. */
const PREVIEW_WIDTHS: readonly (readonly [PresetName, number])[] =
  PREVIEW_CANDIDATES.map(([preset, w]) => [preset, Number.parseInt(w, 10)]);

/**
 * Smallest preview preset at least as wide as the image will be drawn
 * (CSS width × devicePixelRatio), or the largest one if none is. Only the
 * preview presets (w1200/w1920) are candidates: the box is at most 48rem
 * wide, and every extra file+preset costs a transformation.
 */
export const pickPreviewPreset = (
  cssWidth: number,
  devicePixelRatio: number,
): PresetName => pickByWidth(PREVIEW_WIDTHS, cssWidth, devicePixelRatio);
