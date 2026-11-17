/**
 * Parse and validate an image ID string.
 * Returns the parsed number, or null if invalid (NaN or negative).
 *
 * @param raw - Raw string from route params
 * @returns Parsed image ID or null
 */
export const parseImageId = (raw: string): number | null => {
  const id = parseInt(raw, 10);
  if (isNaN(id) || id < 0) return null;
  return id;
};

import { imageUrl } from "~/components/gallery/images";

/**
 * Get the OG image URL for a given image ID.
 * Returns null if the image ID is out of bounds.
 *
 * @param baseUrl - S3 base URL
 * @param media - Array of media objects with file paths
 * @param imageId - Validated image ID
 * @param imageBase - Image Worker base URL, or empty for the original
 * @returns Full image URL or null
 */
export const getOgImageUrl = (
  baseUrl: string,
  media: { file: string }[],
  imageId: number,
  imageBase?: string,
): string | null => {
  if (imageId >= media.length) return null;
  // 1200px wide: social crawlers reject multi-megabyte images, and the
  // originals are up to ~37MB.
  return imageUrl(baseUrl, media[imageId].file, imageBase, "w1200");
};
