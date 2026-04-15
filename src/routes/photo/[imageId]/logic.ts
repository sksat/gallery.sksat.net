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

/**
 * Get the OG image URL for a given image ID.
 * Returns null if the image ID is out of bounds.
 *
 * @param baseUrl - S3 base URL
 * @param media - Array of media objects with file paths
 * @param imageId - Validated image ID
 * @returns Full image URL or null
 */
export const getOgImageUrl = (
  baseUrl: string,
  media: { file: string }[],
  imageId: number,
): string | null => {
  if (imageId >= media.length) return null;
  return baseUrl + media[imageId].file;
};
