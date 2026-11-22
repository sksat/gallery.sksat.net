import { inDate, parseDateKey } from "@shared/calendar/calendar";

import {
  cameraLabel,
  cameraSlug,
  cameraSlugFromPath,
  takenWith,
} from "./cameras";
import { DEFAULT_SORT, parseSort, serializeSort, type SortOrder } from "./sort";
import {
  DEFAULT_TAG_MODE,
  filterMediaByTags,
  parseTagFilter,
  serializeTagFilter,
  type TagFilter,
} from "./tags";
import { PUBLIC_ID_RE, type MediaIndex, type MediaInfo } from "./types";

/**
 * Photos passing the tag filter, taken with the camera `camera` (the
 * camera filter, or a camera page's), and with a date (from the
 * calendar), taken then. Indices stay
 * those of the full media array (they order ties when sorting); the caller
 * sorts.
 */
export const visibleMedia = (
  media: MediaIndex,
  filter: TagFilter,
  camera: string | null,
  date: string | null = null,
): { index: number; value: MediaInfo }[] =>
  filterMediaByTags(media, filter).filter(
    ({ value }) =>
      (camera === null || takenWith(value, camera)) &&
      (date === null || inDate(value.takenDate ?? null, date)),
  );

/** `?date=` of a gallery URL: a year, month or day, else null. */
export const dateParam = (params: URLSearchParams): string | null => {
  const raw = params.get("date");
  return raw !== null && parseDateKey(raw) ? raw : null;
};

/**
 * Navigate to the next or previous image within a filtered set.
 *
 * @param currentId - Current photo's public id
 * @param filteredIndices - Public ids of the filtered set, in display order
 * @param direction - "next" or "prev"
 * @returns New photo id or null if at boundary / not found (e.g. an
 *   unlisted photo, which is in no list)
 */
export const navigateImage = <T>(
  currentId: T,
  filteredIndices: T[],
  direction: "next" | "prev",
): T | null => {
  const currentFilteredIndex = filteredIndices.indexOf(currentId);
  if (currentFilteredIndex === -1) return null;

  if (direction === "next") {
    const nextIndex = currentFilteredIndex + 1;
    return nextIndex < filteredIndices.length
      ? filteredIndices[nextIndex]
      : null;
  } else {
    const prevIndex = currentFilteredIndex - 1;
    return prevIndex >= 0 ? filteredIndices[prevIndex] : null;
  }
};

/**
 * The photos before and after the open one, as ←/→ and swipes step: within
 * the filtered photos, or every photo when the open one is not among them
 * (opened from a URL). An unlisted photo is in neither: no neighbours.
 */
export const neighborIds = <T>(
  current: T,
  filteredIds: T[],
  allIds: T[],
): { prev: T | null; next: T | null } => {
  const ids = filteredIds.includes(current) ? filteredIds : allIds;
  return {
    prev: navigateImage(current, ids, "prev"),
    next: navigateImage(current, ids, "next"),
  };
};

const withQuery = (path: string, params: URLSearchParams) => {
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
};

/** A list's query: its camera, a calendar date, the tag filter, the sort. */
const listParams = (
  filter: TagFilter,
  sort: SortOrder,
  camera: string | null,
  date: string | null,
): URLSearchParams => {
  const params = new URLSearchParams();
  if (camera !== null) params.set("camera", camera);
  if (date !== null) params.set("date", date);
  for (const [key, value] of new URLSearchParams(serializeTagFilter(filter)))
    params.append(key, value);
  for (const [key, value] of serializeSort(sort)) params.append(key, value);
  return params;
};

/**
 * URL of a list: the gallery (`/`) with its filters (the camera, a date
 * from the calendar, the tags) and sort order in the query, so reloading
 * or going Back keeps them.
 */
export const galleryUrl = (
  filter: TagFilter,
  sort: SortOrder = DEFAULT_SORT,
  camera: string | null = null,
  date: string | null = null,
): string => withQuery("/", listParams(filter, sort, camera, date));

/** A photo's URL under `/photo/{id}/`, with the list it is in. */
const photoPath =
  (suffix: string) =>
  (
    imageId: string,
    filter: TagFilter = { tags: [], mode: "and" },
    sort: SortOrder = DEFAULT_SORT,
    camera: string | null = null,
    date: string | null = null,
  ): string =>
    withQuery(
      `/photo/${imageId}/${suffix}`,
      listParams(filter, sort, camera, date),
    );

/**
 * The photo's URL, `/photo/{id}/` (its canonical URL, the one shared): the
 * list it is in (the gallery's query: camera, date, tags, sort; the whole
 * gallery without one) with the photo open over it in the overlay. Loaded directly, it
 * shows the same as a click on the photo's tile.
 */
export const photoUrl = photoPath("");

/**
 * The photo's detail page, `/photo/{id}/detail/`, within the same list:
 * its previous / next and back link follow it.
 */
export const photoDetailUrl = photoPath("detail/");

/** The photo of a `/photo/{id}/` path (trailing slash optional), if any. */
export const photoIdFromPath = (pathname: string): string | null => {
  const match = /^\/photo\/([^/]+)\/?$/.exec(pathname);
  return match && PUBLIC_ID_RE.test(match[1]) ? match[1] : null;
};

/** What the gallery shows for a URL. */
export type GalleryUrlState = {
  /** The photo open in the overlay, else null. */
  selectedImageId: string | null;
  filter: TagFilter;
  sort: SortOrder;
  /** The camera filter (`?camera=`), or a camera page's camera; else null. */
  camera: string | null;
  /** A year, month or day picked in the calendar (`?date=`), else null. */
  date: string | null;
};

/**
 * The gallery state a URL encodes: a list URL (`galleryUrl`), or a photo
 * URL (`photoUrl`), the overlay over the list in its query. A camera page
 * (`/camera/{slug}/`) lists its camera's photos, newest first, with no
 * other filter.
 */
export const galleryStateFromUrl = (url: URL): GalleryUrlState => {
  const params = url.searchParams;
  const selectedImageId = photoIdFromPath(url.pathname);
  const cameraPage =
    selectedImageId === null ? cameraSlugFromPath(url.pathname) : null;
  if (cameraPage !== null) {
    return {
      selectedImageId,
      filter: { tags: [], mode: DEFAULT_TAG_MODE },
      sort: DEFAULT_SORT,
      camera: cameraPage,
      date: null,
    };
  }
  return {
    selectedImageId,
    filter: parseTagFilter(params),
    sort: parseSort(params),
    camera: params.get("camera") || null,
    date: dateParam(params),
  };
};

/**
 * The camera filter's choices: each camera the photos in `media` were
 * taken with (the gallery's other filters applied), with how many, most
 * first, then by name. The chosen camera stays even when none are left.
 */
export const cameraCounts = (
  media: readonly MediaInfo[],
  selected: { slug: string; name: string } | null,
): { slug: string; name: string; count: number }[] => {
  const bySlug = new Map<
    string,
    { slug: string; name: string; count: number }
  >();
  for (const m of media) {
    if (!m.camera) continue;
    const slug = cameraSlug(m.camera);
    const entry = bySlug.get(slug);
    if (entry) entry.count++;
    else bySlug.set(slug, { slug, name: cameraLabel(m.camera), count: 1 });
  }
  if (selected && !bySlug.has(selected.slug)) {
    bySlug.set(selected.slug, { ...selected, count: 0 });
  }
  return [...bySlug.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.name.localeCompare(b.name, "ja") ||
      (a.slug < b.slug ? -1 : 1),
  );
};
