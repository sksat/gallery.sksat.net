import { type FileExifJSON, isScanner } from "./photo-meta";

/**
 * The scanner a file names (its EXIF make and model), when a scanner wrote
 * it; null for a camera's file or one without both.
 */
export const scannerOf = (
  fileExif: FileExifJSON | null | undefined,
): { make: string; model: string } | null => {
  const make = fileExif?.make;
  const model = fileExif?.model;
  return make && model && isScanner(make, model) ? { make, model } : null;
};

/**
 * An UPDATE's SET term linking media.digitized_with to the camera row that
 * names the scanner `make` / `model` (SQL parameters; NULL links nothing):
 * same manufacturer and model, case aside, the first by id. Only while the
 * photo has none and it was not chosen (or cleared) by hand. Never creates
 * a camera row: the edit page offers that.
 */
export const linkDigitizerSql = (make: string, model: string) =>
  `digitized_with = CASE
     WHEN digitized_with IS NULL
      AND COALESCE(json_extract(metadata_source, '$.digitized_with'), '') <> 'manual'
     THEN ${digitizerIdSql(make, model)}
     ELSE digitized_with END`;

/**
 * The id of the camera row naming the scanner `make` / `model` (SQL
 * parameters): same manufacturer and model, case aside, the first by id.
 * NULL when there is none (or for NULL parameters).
 */
export const digitizerIdSql = (make: string, model: string) =>
  `(SELECT c.id FROM camera c
    WHERE lower(c.manufacturer) = lower(${make})
      AND lower(c.model) = lower(${model})
    ORDER BY c.id LIMIT 1)`;
