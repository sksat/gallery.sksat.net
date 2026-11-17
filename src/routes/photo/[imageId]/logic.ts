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
