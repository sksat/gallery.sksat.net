-- What the file says, apart from the shooting information, and the device
-- a photo was digitised with.
--
-- media.exif, media.timestamp and media.camera_id stay the SHOOTING
-- information: shown on the public site as far as its levels allow and
-- embedded in the served images. A photo digitised from an analog original
-- (a negative or slide, an instant photo, a glass plate, a print) has a
-- file whose EXIF describes the scanner (or the camera on a copy stand)
-- and whose date is when it was digitised, so those go apart:
--
-- media.file_exif: the file's own EXIF as read, whatever wrote it (a
--   camera's or a scanner's: make, model, lens, exposure, software,
--   datetimes). Admin only: never public, never embedded.
-- media.digitized_at: when the original was digitised (a scanner's EXIF
--   date). Its own public level (digitized_at, hidden by default); the
--   calendars, sorting and the public taken-at use media.timestamp only.
-- media.digitized_with: the device it was digitised with, a camera row
--   (kind 'scanner', or a camera used to copy it); camera_id stays the
--   camera it was shot with. Public at its own level (digitizer, hidden
--   by default).
-- media.embed_exif: whether this photo's served images carry its public
--   information as EXIF (1 / 0); NULL follows the site's `setting` row
--   'embed_exif' (JSON true / false; true here).
-- camera.kind: gains 'scanner'.
--
-- camera.kind's CHECK cannot be altered in SQLite, and rebuilding `camera`
-- would DROP it, whose implicit DELETE cascades to camera_image (ON DELETE
-- CASCADE) and trips media.camera_id. So the column is swapped instead:
-- renamed, a new one added with the new CHECK, copied, the old one dropped.
-- Nothing else refers to camera.kind (no index, trigger or view), and the
-- table, its rows, ids and foreign keys stay as they are.
ALTER TABLE camera RENAME COLUMN kind TO kind_before_0009;
ALTER TABLE camera ADD COLUMN kind TEXT
  CHECK (kind IN ('digital', 'film', 'phone', 'virtual', 'scanner'));
UPDATE camera SET kind = kind_before_0009;
ALTER TABLE camera DROP COLUMN kind_before_0009;

ALTER TABLE media ADD COLUMN file_exif TEXT
  CHECK (file_exif IS NULL
         OR (json_valid(file_exif) AND json_type(file_exif) = 'object'));
ALTER TABLE media ADD COLUMN digitized_at TEXT;
ALTER TABLE media ADD COLUMN digitized_with INTEGER REFERENCES camera(id);
ALTER TABLE media ADD COLUMN embed_exif INTEGER CHECK (embed_exif IN (0, 1));
-- The camera pages count and list a device's photos (only the few that
-- have one are in it).
CREATE INDEX idx_media_digitized_with ON media(digitized_with)
  WHERE digitized_with IS NOT NULL;

INSERT OR IGNORE INTO setting (key, value) VALUES ('embed_exif', 'true');

-- Existing values move as follows:
--   - an exif read from the file (not edited by hand) is copied into
--     file_exif; an edited one is not the file's, and the metadata reader
--     (a new parser date) fills file_exif from the file itself later;
--   - for a file a scanner wrote (the list of photo-meta.ts isScanner, in
--     SQL below; migrations.spec.ts checks they agree; told by the stored
--     exif, edited or not), digitized_at gets its EXIF DateTimeOriginal
--     (JST when it has no offset), and the automatic shooting values are
--     taken back: exif, and the taken-at when it is that same date or the
--     file has no DateTimeOriginal (the old parser then took its DateTime,
--     the scan's too). A value whose source (0008's metadata_source) is
--     'manual' is kept, so a taken-at set by hand stays (0008 marked
--     those); only a hand-edited exif loses the scanner's own keys.
UPDATE media SET file_exif = exif
WHERE exif IS NOT NULL
  AND COALESCE(json_extract(metadata_source, '$.exif'), '') <> 'manual';

-- The photos a scanner wrote (a scratch table, dropped below).
CREATE TABLE _digitized (id INTEGER PRIMARY KEY);
INSERT INTO _digitized (id)
SELECT id FROM (
  SELECT id,
         COALESCE(json_extract(exif, '$.make'), '') AS mk,
         COALESCE(json_extract(exif, '$.model'), '') AS md
  FROM media WHERE exif IS NOT NULL
)
WHERE mk LIKE '%noritsu%' OR mk LIKE '%plustek%' OR mk LIKE '%pacific image%'
   OR mk LIKE '%scanner%'
   OR (mk LIKE '%fuji%'
       AND (md GLOB '[SsLl][Pp][0-9]*' OR md GLOB '[SsLl][Pp]-[0-9]*'))
   OR md LIKE '%frontier%' OR md LIKE '%pakon%' OR md LIKE '%flextight%'
   OR md LIKE '%coolscan%' OR md GLOB '[Ll][Ss]-[0-9]*'
   OR md LIKE '%perfection%' OR md LIKE '%opticfilm%'
   OR md LIKE 'QSS-%' OR md LIKE 'HS-1800%'
   OR md LIKE 'EZ controller%' OR md LIKE 'EZcontroller%'
   OR md LIKE '%scanner%';

UPDATE media SET digitized_at = (
  SELECT CASE WHEN o GLOB '*[+-][0-9][0-9]:[0-9][0-9]' OR o GLOB '*Z' THEN o
              ELSE o || '+09:00' END
  FROM (SELECT json_extract(media.exif, '$.taken_at_original') AS o)
)
WHERE id IN (SELECT id FROM _digitized);

-- The taken-at, when it is the digitising date (or the file has none, see
-- above) and was filled automatically.
UPDATE media SET
  timestamp = NULL,
  metadata_source = NULLIF(json_remove(metadata_source, '$.taken_at'), '{}')
WHERE id IN (SELECT id FROM _digitized)
  AND timestamp IS NOT NULL
  AND (digitized_at IS NULL
       OR substr(timestamp, 1, 10) = substr(digitized_at, 1, 10))
  AND COALESCE(json_extract(metadata_source, '$.taken_at'), '') <> 'manual';

-- The scanner's EXIF as shooting information, when filled automatically.
UPDATE media SET
  exif = NULL,
  metadata_source = NULLIF(json_remove(metadata_source, '$.exif'), '{}')
WHERE id IN (SELECT id FROM _digitized)
  AND COALESCE(json_extract(metadata_source, '$.exif'), '') <> 'manual';

-- Edited by hand: the edits stay, but an edit kept the keys it did not
-- touch, the scanner's own among them (its make, model, lens and date),
-- which would be public as the camera's at the "all" level. Those go.
UPDATE media SET
  exif = NULLIF(
    json_remove(exif, '$.make', '$.model', '$.lens', '$.taken_at_original'),
    '{}')
WHERE id IN (SELECT id FROM _digitized)
  AND exif IS NOT NULL
  AND json_extract(metadata_source, '$.exif') = 'manual';

-- The device, when a camera row already names it (make and model, case
-- aside; the first by id if several do). Never a new camera row: the
-- admin offers to register one. (A hand-edited exif was not copied: the
-- reader links it once it has read the file.)
UPDATE media SET digitized_with = (
  SELECT c.id FROM camera c
  WHERE lower(c.manufacturer) = lower(json_extract(media.file_exif, '$.make'))
    AND lower(c.model) = lower(json_extract(media.file_exif, '$.model'))
  ORDER BY c.id LIMIT 1
)
WHERE id IN (SELECT id FROM _digitized) AND file_exif IS NOT NULL;

DROP TABLE _digitized;
