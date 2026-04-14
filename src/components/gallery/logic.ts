import type { MediaIndex, MediaInfo, MediaWorld } from "./types";

/**
 * Filter media by world and preserve original indices.
 *
 * @param media - Full media array
 * @param world - World to filter by ("Real" or "VRChat")
 * @returns Array of { index, value } where index is the original position in media
 */
export const filterMediaByWorld = (
  media: MediaIndex,
  world: MediaWorld,
): { index: number; value: MediaInfo }[] =>
  media
    .map((value, index) => ({ index, value }))
    .filter((entry) => entry.value.world === world);

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
