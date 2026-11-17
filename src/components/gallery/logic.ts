import { DEFAULT_SORT, serializeSort, type SortOrder } from "./sort";
import { serializeTagFilter, type TagFilter } from "./tags";

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
 * URL for a gallery state: `/` or `/photo/{id}`, with the tag filter and the
 * sort order kept in the query so closing or sharing a photo preserves them.
 */
export const galleryUrl = (
  imageId: number | null,
  filter: TagFilter,
  sort: SortOrder = DEFAULT_SORT,
): string => {
  const path = imageId === null ? "/" : `/photo/${imageId}`;
  const params = new URLSearchParams(serializeTagFilter(filter));
  for (const [key, value] of serializeSort(sort)) params.append(key, value);
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
};

/** Photo id from a `/photo/{id}` path (trailing slash allowed), else null. */
export const photoIdFromPath = (pathname: string): number | null => {
  const match = /^\/photo\/(\d+)\/?$/.exec(pathname);
  return match ? Number(match[1]) : null;
};
