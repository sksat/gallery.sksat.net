// Where the overlay's info goes on a wide screen (photo-overlay.tsx), so
// it never covers the photo: beside it when the photo leaves a wide enough
// margin at its side, else in a strip under it.

/**
 * The overlay's photo box beside its info: 90vw wide, and the screen's
 * height less 3.5rem above (the date) and below (photo-overlay.tsx).
 */
const BOX_W = 0.9;
export const BOX_MARGIN_Y_PX = 2 * 56;

/** The side card's width and its gaps on both sides (CSS px). */
export const SIDE_CARD_PX = 320;
export const SIDE_GAP_PX = 24;

export type WideInfoPlace = "side" | "below";

/**
 * "side" when the photo, as large as the box shows it, leaves a margin at
 * each side wide enough for the card; else "below". A photo of unknown
 * shape goes "below" (that never overlaps, whatever its shape).
 */
export const wideInfoPlace = (
  viewWidth: number,
  viewHeight: number,
  ratio: number | null,
): WideInfoPlace => {
  if (ratio === null || !(ratio > 0)) return "below";
  const shown = Math.min(
    BOX_W * viewWidth,
    (viewHeight - BOX_MARGIN_Y_PX) * ratio,
  );
  const margin = (viewWidth - shown) / 2;
  return margin >= SIDE_CARD_PX + 2 * SIDE_GAP_PX ? "side" : "below";
};

/**
 * Before the screen is known (a server-rendered overlay): below, which
 * never covers the photo nor runs off the screen, whatever their sizes.
 */
export const SERVER_WIDE_INFO_PLACE: WideInfoPlace = "below";
