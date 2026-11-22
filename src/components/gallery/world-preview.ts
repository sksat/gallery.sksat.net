// The preview card of a photo's VRChat world (world-link.tsx): what the
// API answers (workers/api/src/world-route.ts WorldCard). Where the card
// goes on screen: shared/preview/position.ts.

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
