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
-- added; the old code ignores them). Deploy the code soon after: an
-- exif/world edit made with the old code in between gets no 'manual'
-- mark, and the new code reads every photo again once.
ALTER TABLE media ADD COLUMN metadata_source TEXT
  CHECK (metadata_source IS NULL
         OR (json_valid(metadata_source)
             AND json_type(metadata_source) = 'object'));

-- The taken-at times so far were filled in automatically (the VRChat file
-- names or EXIF at upload, or the old media.json): the weakest automatic
-- source, so the next reading may improve them. exif and world came from
-- the file, unless the file was never read (then only a hand could have
-- filled them) or the photo was edited after it was read: then they may
-- have been edited by hand, and are kept as 'manual' (losing a possible
-- improvement rather than an edit). Location keeps location_source.
UPDATE media SET metadata_source = (
  SELECT json_group_object(key, value) FROM (
    SELECT 'taken_at' AS key, 'filename' AS value WHERE media.timestamp IS NOT NULL
    UNION ALL
    SELECT 'exif', CASE WHEN media.metadata_read_at IS NULL
                          OR media.updated_at > media.metadata_read_at
                        THEN 'manual' ELSE 'file' END
      WHERE media.exif IS NOT NULL
    UNION ALL
    SELECT 'world', CASE WHEN media.metadata_read_at IS NULL
                           OR media.updated_at > media.metadata_read_at
                         THEN 'manual' ELSE 'file' END
      WHERE media.world_id IS NOT NULL OR media.world_name IS NOT NULL
  )
)
WHERE timestamp IS NOT NULL OR exif IS NOT NULL
   OR world_id IS NOT NULL OR world_name IS NOT NULL;

-- The admin's metadata reader looks for photos to read by
-- metadata_read_at (NULL, before the parser date, or a stale claim /
-- failure: src/lib/backfill.ts) on every batch; without this index each
-- look would scan the whole table.
CREATE INDEX idx_media_metadata_read_at ON media(metadata_read_at);
