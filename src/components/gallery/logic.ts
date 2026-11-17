import { cameraHref, takenWith } from "./cameras";
import { DEFAULT_SORT, serializeSort, type SortOrder } from "./sort";
import { filterMediaByTags, serializeTagFilter, type TagFilter } from "./tags";
import type { MediaIndex, MediaInfo } from "./types";

/**
 * Photos passing the tag filter and, on a camera page, taken with that
 * camera. Indices stay those of the full media array (they are the photo
 * IDs); the caller sorts.
 */
export const visibleMedia = (
  media: MediaIndex,
  filter: TagFilter,
  camera: string | null,
): { index: number; value: MediaInfo }[] => {
  const tagged = filterMediaByTags(media, filter);
  return camera === null
    ? tagged
    : tagged.filter(({ value }) => takenWith(value, camera));
};

/**
 * Navigate to the next or previous image within a filtered set.
 *
 * @param currentId - Current image ID (index in the full media array)
 * @param filteredIndices - Array of indices in the filtered set
 * @param direction - "next" or "prev"
 * @returns New image ID or null if at boundary / not found
 */
export const navigateImage = (
  currentId: number,
  filteredIndices: number[],
  direction: "next" | "prev",
): number | null => {
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
 * URL for a gallery state: `/`, `/camera/{slug}/` or `/photo/{id}`, with the
 * tag filter and the sort order kept in the query so closing or sharing a
 * photo preserves them. A photo opened from a camera page carries
 * `?camera={slug}` so closing it returns to that page.
 */
export const galleryUrl = (
  imageId: number | null,
  filter: TagFilter,
  sort: SortOrder = DEFAULT_SORT,
  camera: string | null = null,
): string => {
  const params = new URLSearchParams();
  let path: string;
  if (imageId !== null) {
    path = `/photo/${imageId}`;
    if (camera !== null) params.set("camera", camera);
  } else {
    path = camera === null ? "/" : cameraHref(camera);
  }
  for (const [key, value] of new URLSearchParams(serializeTagFilter(filter)))
    params.append(key, value);
  for (const [key, value] of serializeSort(sort)) params.append(key, value);
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
};

/** Photo id from a `/photo/{id}` path (trailing slash allowed), else null. */
export const photoIdFromPath = (pathname: string): number | null => {
  const match = /^\/photo\/(\d+)\/?$/.exec(pathname);
  return match ? Number(match[1]) : null;
};
