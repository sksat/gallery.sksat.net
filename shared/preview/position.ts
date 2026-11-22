// Where a hover card goes on screen: the gallery's and the admin's preview
// cards (a world, a camera, a photo) beside the link they describe.

type Rect = { top: number; bottom: number; left: number };

/** Space kept between the card and the screen's edges or the link (px). */
const GAP = 8;

/**
 * Where the card (`width` × `height`) goes for a link at `link`, in a
 * `viewport`: under the link, its left edge at the link's, kept on screen;
 * above the link when it does not fit under it but does above.
 */
export const cardPosition = (
  link: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } => {
  const left = Math.max(
    GAP,
    Math.min(link.left, viewport.width - card.width - GAP),
  );
  const below = link.bottom + GAP;
  const above = link.top - GAP - card.height;
  const top =
    below + card.height > viewport.height - GAP && above >= GAP ? above : below;
  return { top, left };
};

/** How long the pointer rests on a link before its card shows (ms). */
export const HOVER_MS = 300;
