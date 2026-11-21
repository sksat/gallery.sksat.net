/**
 * OGP / Twitter card meta tags for the top page and photo pages.
 *
 * Kept pure (no fetch, no import.meta.env) so the head can be unit tested;
 * the route loaders pass in the photos from the API and the base URLs.
 */
import type { DocumentHeadValue } from "@builder.io/qwik-city";

import {
  CAMERA_LIST_HREF,
  cameraHref,
  cameraLabel,
  takenWith,
} from "./gallery/cameras";
import {
  dimensionsFromFile,
  imageUrl,
  photoSize,
  type ImageSource,
} from "./gallery/images";
import { mediaTags } from "./gallery/tags";
import { takenJa } from "./gallery/taken";
import {
  parseMediaTimestamp,
  transformMediaInfo,
  type CameraJSON,
  type MediaInfoJSON,
} from "./gallery/types";

export const SITE_URL = "https://gallery.sksat.net";
export const SITE_NAME = "sksat gallery";
export const SITE_DESCRIPTION =
  "sksat が撮った写真と VRChat のスクリーンショットを集めたギャラリーです。";

/** Size of the image Worker's `og` preset (workers/image/src/request.ts). */
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;

export type OgImage = {
  url: string;
  alt: string;
  width?: number;
  height?: number;
};

export type Ogp = {
  title: string;
  description: string;
  /** Absolute page URL. */
  url: string;
  type: "website" | "article";
  image: OgImage | null;
};

/** Where the photos and the image Worker live (see images.ts). */
export type ImageBases = {
  s3Base: string;
  /** VITE_IMAGE_BASE_URL; empty in dev and tests, where originals are used. */
  imageBase?: string;
};

/**
 * Card image for a photo: one of the Worker's 1200x630 card presets (`og`
 * adds the photo's date, camera and tags; `og-site` has just the badge), or
 * the original when the Worker is not configured (its size then from the
 * API, else from a VRChat file name).
 */
export const ogImage = (
  { s3Base, imageBase }: ImageBases,
  src: ImageSource,
  alt: string,
  preset: "og" | "og-site",
): OgImage => ({
  // A photo by its public id, or a camera picture by its bucket path (the
  // Worker draws the badge-only `og-site` card for those).
  url: imageUrl(s3Base, src, imageBase, preset),
  alt,
  ...(imageBase
    ? OG_CARD_SIZE
    : typeof src === "string"
      ? dimensionsFromFile(src)
      : // The original itself: its name may say its size too.
        { ...dimensionsFromFile(src.file), ...photoSize(src) }),
});

const photoSource = ({ id, file, width, height }: MediaInfoJSON) => ({
  id,
  file,
  width,
  height,
});

/**
 * Index of the newest photo by timestamp, used as the top page's card.
 * Ties go to the later entry; if no photo has a timestamp, the last entry.
 * Null for an empty index.
 */
export const newestMediaIndex = (media: MediaInfoJSON[]): number | null => {
  if (media.length === 0) return null;
  let best = media.length - 1;
  let bestTime = -Infinity;
  media.forEach((m, index) => {
    const time = parseMediaTimestamp(m.timestamp)?.getTime();
    if (time !== undefined && time >= bestTime) {
      best = index;
      bestTime = time;
    }
  });
  return best;
};

export const topOgp = (bases: ImageBases, media: MediaInfoJSON[]): Ogp => {
  const newest = newestMediaIndex(media);
  return {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: `${SITE_URL}/`,
    type: "website",
    image:
      newest === null
        ? null
        : ogImage(
            bases,
            photoSource(media[newest]),
            `${SITE_NAME} の最新の写真`,
            "og-site",
          ),
  };
};

/** Card for /photo/<id>. */
export const photoOgp = (bases: ImageBases, m: MediaInfoJSON): Ogp => {
  const tags = mediaTags({ ...m, timestamp: parseMediaTimestamp(m.timestamp) });
  const camera = m.camera ? cameraLabel(m.camera) : m.maker;
  // As precisely as the API gives it, in the photo's own offset: the same
  // as the gallery and the photo page show (taken.ts).
  const taken = takenJa(m.timestamp, m.timestamp_precision);

  // What the title names the photo by, from its public fields only: its
  // day "@" its VRChat world, then "📷" its camera (or maker); with none of
  // them, the title is just the site's name.
  const subject =
    [
      [taken?.day, m.world?.name].filter(Boolean).join(" @ "),
      camera && `📷 ${camera}`,
    ]
      .filter(Boolean)
      .join(" ") || null;
  const description = [
    taken && `${taken.full} 撮影。`,
    tags.length > 0 && `タグ: ${tags.join(", ")}。`,
    camera && `カメラ: ${camera}。`,
  ]
    .filter(Boolean)
    .join("");

  return {
    title: subject ? `${subject} | ${SITE_NAME}` : SITE_NAME,
    description: description || `${SITE_NAME} の写真です。`,
    // Qwik City redirects /photo/<id> to the trailing-slash form.
    url: `${SITE_URL}/photo/${m.id}/`,
    type: "article",
    image: ogImage(bases, photoSource(m), subject ?? "写真", "og"),
  };
};

/**
 * Card for /camera/<slug>/: the camera's first picture, else the newest
 * photo taken with it (both as the plain `og-site` card).
 */
export const cameraOgp = (
  bases: ImageBases,
  media: MediaInfoJSON[],
  camera: CameraJSON,
): Ogp => {
  const own = media.filter((m) =>
    takenWith(transformMediaInfo(m), camera.slug),
  );
  const newest = newestMediaIndex(own);
  const src: ImageSource | null =
    camera.images.at(0)?.file ??
    (newest === null ? null : photoSource(own[newest]));
  return {
    title: `${camera.name} | ${SITE_NAME}`,
    description:
      camera.description?.split("\n")[0] ||
      `${camera.name} で撮った写真 (${own.length} 枚)。`,
    url: SITE_URL + cameraHref(camera.slug),
    type: "website",
    image: src === null ? null : ogImage(bases, src, camera.name, "og-site"),
  };
};

/** Card for the camera list (/camera/): the site badge card, like the top. */
export const cameraListOgp = (
  bases: ImageBases,
  media: MediaInfoJSON[],
): Ogp => ({
  ...topOgp(bases, media),
  title: `カメラ | ${SITE_NAME}`,
  description: `${SITE_NAME} の写真を撮ったカメラの一覧です。`,
  url: SITE_URL + CAMERA_LIST_HREF,
});

/** Card for the calendar (/calendar/…): the site card, like the top. */
export const calendarOgp = (
  bases: ImageBases,
  media: MediaInfoJSON[],
  /** "2023年12月", "2023年", or null for /calendar/ itself. */
  label: string | null,
  path: string,
): Ogp => ({
  ...topOgp(bases, media),
  title: `${label ? `カレンダー ${label}` : "カレンダー"} | ${SITE_NAME}`,
  description: `${SITE_NAME} の写真を撮影日のカレンダーで見られます。`,
  url: SITE_URL + path,
});

/** Card for the map (/map/): the site card, like the top. */
export const mapOgp = (bases: ImageBases, media: MediaInfoJSON[]): Ogp => ({
  ...topOgp(bases, media),
  title: `地図 | ${SITE_NAME}`,
  description: `${SITE_NAME} の写真を撮った場所の地図です。`,
  url: `${SITE_URL}/map/`,
});

/**
 * Keeps a calendar page with no photos (any year or month can be opened by
 * URL) out of search results.
 */
export const noindexIfEmpty = <
  H extends { meta: readonly { name?: string; content?: string }[] },
>(
  head: H,
  count: number,
): H =>
  count > 0
    ? head
    : { ...head, meta: [...head.meta, { name: "robots", content: "noindex" }] };

/** Fallback when the photos could not be read: text-only card. */
export const fallbackOgp = (path: string): Ogp => ({
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL + path,
  type: "website",
  image: null,
});

/** `title` and `meta` for Qwik City's DocumentHead. */
export const ogpHead = (
  ogp: Ogp,
): Required<Pick<DocumentHeadValue, "title" | "meta">> => {
  const { image } = ogp;
  const property = (name: string, content: string | number) => ({
    property: name,
    content: String(content),
  });
  return {
    title: ogp.title,
    meta: [
      { name: "description", content: ogp.description },
      property("og:site_name", SITE_NAME),
      property("og:type", ogp.type),
      property("og:url", ogp.url),
      property("og:title", ogp.title),
      property("og:description", ogp.description),
      ...(image
        ? [
            property("og:image", image.url),
            ...(image.width && image.height
              ? [
                  property("og:image:width", image.width),
                  property("og:image:height", image.height),
                ]
              : []),
            property("og:image:alt", image.alt),
          ]
        : []),
      {
        name: "twitter:card",
        content: image ? "summary_large_image" : "summary",
      },
    ],
  };
};
