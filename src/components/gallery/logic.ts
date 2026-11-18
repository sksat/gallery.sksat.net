import { inDate, parseDateKey } from "@shared/calendar/calendar";

import { cameraHref, takenWith } from "./cameras";
import { DEFAULT_SORT, serializeSort, type SortOrder } from "./sort";
import { filterMediaByTags, serializeTagFilter, type TagFilter } from "./tags";
import { PUBLIC_ID_RE, type MediaIndex, type MediaInfo } from "./types";

/**
 * Photos passing the tag filter and, on a camera page, taken with that
 * camera, and with a date (from the calendar), taken then. Indices stay
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

/**
 * URL for a gallery state: `/`, `/camera/{slug}/` or `/photo/{id}`, with the
 * tag filter and the sort order kept in the query so closing or sharing a
 * photo preserves them. A photo opened from a camera page carries
 * `?camera={slug}` so closing it returns to that page. A date from the
 * calendar is kept as `?date=` on either.
 */
export const galleryUrl = (
  imageId: string | null,
  filter: TagFilter,
  sort: SortOrder = DEFAULT_SORT,
  camera: string | null = null,
  date: string | null = null,
): string => {
  const params = new URLSearchParams();
  let path: string;
  if (imageId !== null) {
    path = `/photo/${imageId}`;
    if (camera !== null) params.set("camera", camera);
  } else {
    path = camera === null ? "/" : cameraHref(camera);
  }
  if (date !== null) params.set("date", date);
  for (const [key, value] of new URLSearchParams(serializeTagFilter(filter)))
    params.append(key, value);
  for (const [key, value] of serializeSort(sort)) params.append(key, value);
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
};

/**
 * Public id from a `/photo/{id}` path (trailing slash allowed), else null.
 * Old `/photo/{N}` paths are not ids: their route redirects them.
 */
export const photoIdFromPath = (pathname: string): string | null => {
  const match = /^\/photo\/([^/]+)\/?$/.exec(pathname);
  return match && PUBLIC_ID_RE.test(match[1]) ? match[1] : null;
};
