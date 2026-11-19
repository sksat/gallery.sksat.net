-- Where each piece of a photo's metadata came from, so that reading the
-- original again (a better parser) can improve what was read before
-- without touching what was entered by hand.
--
-- media.metadata_source: a JSON object of field → source (NULL or a
--   missing field = not known: treated as the weakest automatic source).
--   taken_at: 'manual' > 'exif' (DateTimeOriginal) > 'xmp' (xmp:CreateDate)
--             > 'filename' (VRChat's file name) > 'file_date' (EXIF
--             DateTime, when the file was written)
--   exif:     'manual' > 'file'
--   world:    'manual' > 'file'
--   (Where it was taken keeps its own media.location_source, 0005.)
--   A new reading replaces a field only when its source ranks at least as
--   high as the stored one; 'manual' is never replaced.
--
-- Safe to apply before the code that uses it (a column and an index are
-- added; the old code ignores them). Deploy the code soon after: a
-- taken-at/exif/world edit made with the old code in between gets no
-- 'manual' mark, and the new code reads every photo again once.
ALTER TABLE media ADD COLUMN metadata_source TEXT
  CHECK (metadata_source IS NULL
         OR (json_valid(metadata_source)
             AND json_type(metadata_source) = 'object'));

-- Everything so far was filled in automatically: the taken-at times from
-- the VRChat file names or EXIF at upload (or the old media.json), exif
-- and world from the file. None of them has been edited by hand yet, so
-- all are marked automatic, the taken-at times as the weakest source, and
-- the next reading may improve them. (updated_at cannot tell a hand edit
-- apart: completing an upload and any other edit move it too.) Location
-- keeps location_source.
UPDATE media SET metadata_source = (
  SELECT json_group_object(key, value) FROM (
    SELECT 'taken_at' AS key, 'filename' AS value WHERE media.timestamp IS NOT NULL
    UNION ALL
    SELECT 'exif', 'file' WHERE media.exif IS NOT NULL
    UNION ALL
    SELECT 'world', 'file'
      WHERE media.world_id IS NOT NULL OR media.world_name IS NOT NULL
  )
)
WHERE timestamp IS NOT NULL OR exif IS NOT NULL
   OR world_id IS NOT NULL OR world_name IS NOT NULL;

-- Except the taken-at times entered by hand for files a scanner wrote:
-- their EXIF dates are the scan's (some scanners' unset clock: 2021-01-01),
-- so a taken-at that is not that date was set by hand (from the folder,
-- with the taken-at shown only to the date or month). Mark those, and any
-- taken-at whose photo shows it only to the date, month or year, as
-- 'manual', so that no reading ever replaces them. The scanner list is
-- photo-meta.ts isFilmScanner's (migrations.spec.ts checks they agree).
UPDATE media SET metadata_source = json_set(metadata_source, '$.taken_at', 'manual')
WHERE timestamp IS NOT NULL
  AND (
    json_extract(metadata_visibility, '$.taken_at') IN ('date', 'month', 'year')
    OR (
      (
        COALESCE(json_extract(exif, '$.make'), '') LIKE '%noritsu%'
        OR COALESCE(json_extract(exif, '$.make'), '') LIKE '%plustek%'
        OR COALESCE(json_extract(exif, '$.make'), '') LIKE '%pacific image%'
        OR COALESCE(json_extract(exif, '$.make'), '') LIKE '%scanner%'
        OR (COALESCE(json_extract(exif, '$.make'), '') LIKE '%fuji%'
            AND (COALESCE(json_extract(exif, '$.model'), '') GLOB '[SsLl][Pp][0-9]*'
                 OR COALESCE(json_extract(exif, '$.model'), '') GLOB '[SsLl][Pp]-[0-9]*'))
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%frontier%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%pakon%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%flextight%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%coolscan%'
        OR COALESCE(json_extract(exif, '$.model'), '') GLOB '[Ll][Ss]-[0-9]*'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%perfection%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%opticfilm%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE 'QSS-%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE 'HS-1800%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE 'EZ controller%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE 'EZcontroller%'
        OR COALESCE(json_extract(exif, '$.model'), '') LIKE '%scanner%'
      )
      -- Only against a date the file has: without DateTimeOriginal the old
      -- parser took the file's DateTime, the scan's as well, which is no
      -- hand edit.
      AND json_extract(exif, '$.taken_at_original') IS NOT NULL
      AND substr(timestamp, 1, 10)
          <> substr(json_extract(exif, '$.taken_at_original'), 1, 10)
    )
  );

-- The admin's metadata reader looks for photos to read by
-- metadata_read_at (NULL, before the parser date, or a stale claim /
-- failure: src/lib/backfill.ts) on every batch; without this index each
-- look would scan the whole table.
CREATE INDEX idx_media_metadata_read_at ON media(metadata_read_at);
