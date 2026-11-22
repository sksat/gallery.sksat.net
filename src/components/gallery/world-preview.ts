// The preview card of a photo's VRChat world (world-preview.tsx): what the
// API answers (workers/api/src/world-route.ts WorldCard) and where the
// card goes on screen.

export type WorldCard = {
  name: string;
  author: string | null;
  description: string | null;
  /** The picture is at the image Worker's /img/world/<public_id>. */
  image: boolean;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** The API's answer as a card, or null when it is not one. */
export const parseWorldCard = (value: unknown): WorldCard | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = str(v.name);
  if (!name) return null;
  return {
    name,
    author: str(v.author),
    description: str(v.description),
    image: v.image === true,
  };
};

/** Where the card's data is: on the site's own origin. */
export const worldCardUrl = (photoId: string) =>
  `/api/media/${encodeURIComponent(photoId)}/world`;

/** The picture, at the image Worker; none without one (dev, tests). */
export const worldImageUrl = (
  imageBase: string | undefined,
  photoId: string,
): string | null =>
  imageBase
    ? `${imageBase.replace(/\/$/, "")}/world/${encodeURIComponent(photoId)}`
    : null;

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
