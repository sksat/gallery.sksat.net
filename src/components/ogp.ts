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
  type ImageSource,
} from "./gallery/images";
import { mediaTags } from "./gallery/tags";
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

const pad = (n: number) => String(n).padStart(2, "0");

/** Date and time in JST, e.g. { date: "2023年12月16日", time: "23:12" }. */
export const formatJst = (d: Date): { date: string; time: string } => {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`,
    time: `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`,
  };
};

/**
 * Card image for a photo: one of the Worker's 1200x630 card presets (`og`
 * adds the photo's date, camera and tags; `og-site` has just the badge), or
 * the original when the Worker is not configured (its size is then known
 * only from VRChat file names).
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
    : dimensionsFromFile(typeof src === "string" ? src : src.file)),
});

const photoSource = ({ id, file }: MediaInfoJSON) => ({ id, file });

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
  const taken = parseMediaTimestamp(m.timestamp);
  const jst = taken && formatJst(taken);
  const tags = mediaTags({ ...m, timestamp: taken });
  const camera = m.camera ? cameraLabel(m.camera) : m.maker;
  // Cut down to a date, month or year: say only that much, as the API
  // wrote it (the photo's own offset).
  const parts = /^(\d{4})-(\d\d)-(\d\d)/.exec(m.timestamp ?? "");
  const coarse =
    parts &&
    {
      date: `${parts[1]}年${Number(parts[2])}月${Number(parts[3])}日`,
      month: `${parts[1]}年${Number(parts[2])}月`,
      year: `${parts[1]}年`,
    }[m.timestamp_precision as string];

  const day = coarse ?? jst?.date;
  const subject = day ? `${day}の写真` : "写真";
  const description = [
    coarse ? `${coarse} 撮影。` : jst && `${jst.date} ${jst.time} 撮影。`,
    tags.length > 0 && `タグ: ${tags.join(", ")}。`,
    camera && `カメラ: ${camera}。`,
  ]
    .filter(Boolean)
    .join("");

  return {
    title: `${subject} | ${SITE_NAME}`,
    description: description || `${SITE_NAME} の写真です。`,
    // Qwik City redirects /photo/<id> to the trailing-slash form.
    url: `${SITE_URL}/photo/${m.id}/`,
    type: "article",
    image: ogImage(bases, photoSource(m), subject, "og"),
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
