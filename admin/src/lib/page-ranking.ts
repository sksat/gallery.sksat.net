// The dashboard's ranking of the public site's pages: each Web Analytics
// path is classified (a photo, a camera, a calendar month, …), the forms
// of one page (with and without the trailing slash; a photo's URL and its
// /detail/ page as one photo) are added up, and the
// top pages are named from D1 (photos by public id, cameras by slug, one
// IN lookup each for the shown rows only). Old numeric /photo/<N> URLs
// map to nothing (media.legacy_index was dropped in 0005), so they stay
// what they are.

import type { MediaPlatform, Visibility } from "./types";
import { LIVE_PHOTO } from "./types";
import { PUBLIC_SITE_URL } from "./format";
import { PUBLIC_ID_RE } from "./public-id";
import type { AccessStats, Counts } from "./web-analytics";

export type PageKind =
  | { kind: "top" }
  | { kind: "photo"; publicId: string }
  | { kind: "old-photo" }
  | { kind: "cameras" }
  | { kind: "camera"; slug: string }
  | { kind: "calendar"; year?: number; month?: number }
  | { kind: "map" }
  | { kind: "other" };

const CAMERA_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a public site path is; the trailing slash is optional. */
export const classifyPath = (path: string): PageKind => {
  if (path === "/") return { kind: "top" };
  const parts = path.replace(/^\/|\/$/g, "").split("/");
  const [head, a, b, ...rest] = parts;
  if (rest.length > 0) return { kind: "other" };
  switch (head) {
    case "photo":
      if (a !== undefined && b === undefined) {
        if (PUBLIC_ID_RE.test(a)) return { kind: "photo", publicId: a };
        if (/^\d+$/.test(a)) return { kind: "old-photo" };
      }
      // Its detail page is a view of the same photo.
      if (a !== undefined && b === "detail" && PUBLIC_ID_RE.test(a)) {
        return { kind: "photo", publicId: a };
      }
      break;
    case "camera":
      if (a === undefined) return { kind: "cameras" };
      if (b === undefined && CAMERA_SLUG_RE.test(a)) {
        return { kind: "camera", slug: a };
      }
      break;
    case "calendar": {
      if (a === undefined) return { kind: "calendar" };
      if (!/^\d{4}$/.test(a)) break;
      const year = Number(a);
      if (b === undefined) return { kind: "calendar", year };
      if (!/^\d{2}$/.test(b)) break;
      const month = Number(b);
      if (month >= 1 && month <= 12) return { kind: "calendar", year, month };
      break;
    }
    case "map":
      if (a === undefined) return { kind: "map" };
      break;
  }
  return { kind: "other" };
};

/**
 * One page per entry: the canonical path (with the trailing slash, as the
 * site links it), what it is, and the page views and visits of all its
 * forms. Every old numeric /photo/<N> URL is one entry together, with
 * OLD_PHOTO_PATH as its path: they were never shared and lead nowhere.
 */
export type RankedPath = { path: string; page: PageKind } & Counts;

export const OLD_PHOTO_PATH = "/photo/<N>/";

const canonicalPath = (path: string, page: PageKind): string =>
  page.kind === "old-photo"
    ? OLD_PHOTO_PATH
    : page.kind === "photo"
      ? `/photo/${page.publicId}/`
      : page.kind === "other" || path.endsWith("/")
      ? path
      : `${path}/`;

/**
 * The top `limit` pages by page views (most first, then by path), forms
 * added up, and after them the old numeric URLs' one entry, if any came.
 */
export const rankPaths = (
  pages: AccessStats["pages"],
  limit: number,
): RankedPath[] => {
  const acc = new Map<string, RankedPath>();
  for (const p of pages) {
    const page = classifyPath(p.path);
    const path = canonicalPath(p.path, page);
    const a = acc.get(path) ?? { path, page, pageViews: 0, visits: 0 };
    a.pageViews += p.pageViews;
    a.visits += p.visits;
    acc.set(path, a);
  }
  const old = acc.get(OLD_PHOTO_PATH);
  acc.delete(OLD_PHOTO_PATH);
  const top = [...acc.values()]
    .sort(
      (a, b) =>
        b.pageViews - a.pageViews ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .slice(0, limit);
  return old ? [...top, old] : top;
};

/** The public ids and camera slugs to look up for these pages. */
export const lookupsOf = (
  ranked: RankedPath[],
): { publicIds: string[]; slugs: string[] } => {
  const publicIds = new Set<string>();
  const slugs = new Set<string>();
  for (const r of ranked) {
    if (r.page.kind === "photo") publicIds.add(r.page.publicId);
    if (r.page.kind === "camera") slugs.add(r.page.slug);
  }
  return { publicIds: [...publicIds], slugs: [...slugs] };
};

export type RankingPhoto = {
  id: number;
  public_id: string;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: Visibility;
};

export type RankingCamera = { slug: string; name: string };

/** A row of the ranking, ready to render (serializable). */
export type RankedPage = Counts &
  (
    | { kind: "photo"; photo: RankingPhoto; href: string }
    /** `page` is the page's kind (its icon). */
    | { kind: "page"; page: PageKind["kind"]; label: string; href: string }
    /** A photo URL whose photo is not listed (deleted, trashed, unknown). */
    | { kind: "gone"; path: string }
    /** All old numeric /photo/<N> URLs together. */
    | { kind: "old" }
  );

/** The name of a page that is not a photo; null when it has none. */
export const pageLabel = (
  page: PageKind,
  cameras: ReadonlyMap<string, string>,
): string | null => {
  switch (page.kind) {
    case "top":
      return "トップ";
    case "cameras":
      return "カメラ";
    case "camera":
      return cameras.get(page.slug) ?? null;
    case "calendar":
      return page.year === undefined
        ? "カレンダー"
        : page.month === undefined
          ? `${page.year}年`
          : `${page.year}年${page.month}月`;
    case "map":
      return "地図";
    default:
      return null;
  }
};

/**
 * Names the ranked pages from the looked-up rows. `photos` is null when
 * they could not be looked up (no D1, or the query failed): photo pages
 * then stay plain links by their path rather than look gone.
 */
export const resolveRanking = (
  ranked: RankedPath[],
  photos: RankingPhoto[] | null,
  cameras: RankingCamera[],
): RankedPage[] => {
  const byPublic = new Map((photos ?? []).map((p) => [p.public_id, p]));
  const cameraNames = new Map(cameras.map((c) => [c.slug, c.name]));
  return ranked.map(({ path, page, pageViews, visits }): RankedPage => {
    const counts = { pageViews, visits };
    const href = `${PUBLIC_SITE_URL}${path}`;
    if (page.kind === "photo" && photos) {
      const photo = byPublic.get(page.publicId);
      return photo
        ? { kind: "photo", photo, href, ...counts }
        : { kind: "gone", path, ...counts };
    }
    if (page.kind === "old-photo") return { kind: "old", ...counts };
    return {
      kind: "page",
      page: page.kind,
      label: pageLabel(page, cameraNames) ?? path,
      href,
      ...counts,
    };
  });
};

// D1 caps bound parameters per query at 100; the ranking is far shorter.
const placeholders = (n: number) => Array(n).fill("?").join(", ");

/**
 * The photos with these public ids that are ready and not in the trash,
 * any visibility (one IN lookup).
 */
export const rankingPhotos = async (
  db: D1Database,
  publicIds: string[],
): Promise<RankingPhoto[]> => {
  if (publicIds.length === 0) return [];
  const r = await db
    .prepare(
      `SELECT id, public_id, file, path, platform, visibility FROM media WHERE ${LIVE_PHOTO} AND public_id IN (${placeholders(publicIds.length)})`,
    )
    .bind(...publicIds)
    .all<RankingPhoto>();
  return r.results;
};

/** The cameras with these slugs (one IN lookup). */
export const rankingCameras = async (
  db: D1Database,
  slugs: string[],
): Promise<RankingCamera[]> => {
  if (slugs.length === 0) return [];
  const r = await db
    .prepare(
      `SELECT slug, name FROM camera WHERE slug IN (${placeholders(slugs.length)})`,
    )
    .bind(...slugs)
    .all<RankingCamera>();
  return r.results;
};
