-- A camera picture may be a photo of the library (0017 and 0018 are
-- taken by other changes). camera_image gets `media_id`: exactly one of
-- `file` (a bucket object of its own, as before) and `media_id` (a photo,
-- shown from the file the photo shows, or its display copy) is set.
--
-- A photo picture is public only while its photo may be opened (public or
-- unlisted, ready, not in the trash; the API Worker checks it), and goes
-- with the photo when that is deleted for good (ON DELETE CASCADE).
--
-- Before this, a picture whose `file` was a photo's object was hidden by
-- the API. Such rows become references to that photo (one per camera and
-- photo, the first in order), and from now on `file` is never a photo's
-- object, nor a photo's object a picture's `file` (the triggers below), so
-- a picture by `file` never gives away a photo's bytes.
--
-- SQLite cannot drop NOT NULL from a column: the table is rebuilt.
-- Nothing references camera_image, so dropping it cascades nowhere.
CREATE TABLE camera_image_new (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL REFERENCES camera(id) ON DELETE CASCADE,
  file      TEXT CHECK (file <> ''),
  media_id  INTEGER REFERENCES media(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  caption   TEXT,
  CHECK ((file IS NULL) <> (media_id IS NULL)),
  UNIQUE (camera_id, file),
  UNIQUE (camera_id, media_id)
);

INSERT INTO camera_image_new (id, camera_id, file, media_id, position, caption)
SELECT id, camera_id, CASE WHEN mid IS NULL THEN file END, mid, position,
  caption
FROM (
  SELECT i.*, f.media_id AS mid,
    ROW_NUMBER() OVER (PARTITION BY i.camera_id, f.media_id
                       ORDER BY i.position, i.id) AS rn
  FROM camera_image i
  LEFT JOIN media_file f ON f.storage = 'b2' AND f.object_key = i.file
)
WHERE mid IS NULL OR rn = 1;

-- Pictures that became photos change what the API answers (their path):
-- a new content version (admin/src/lib/last-good.ts), only then.
INSERT INTO setting (key, value)
SELECT 'content_version', json_quote(lower(hex(randomblob(12))))
WHERE EXISTS (SELECT 1 FROM camera_image_new WHERE media_id IS NOT NULL)
ON CONFLICT (key) DO UPDATE SET value = excluded.value,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

DROP TABLE camera_image;
ALTER TABLE camera_image_new RENAME TO camera_image;

CREATE INDEX idx_camera_image_camera ON camera_image(camera_id, position);
-- The checks below, and the upload's name check (a photo never takes a
-- picture's object).
CREATE INDEX idx_camera_image_file ON camera_image(file)
  WHERE file IS NOT NULL;
-- A photo's pictures (the admin's picker, the cascade on delete).
CREATE INDEX idx_camera_image_media ON camera_image(media_id)
  WHERE media_id IS NOT NULL;

CREATE TRIGGER camera_image_file_insert
BEFORE INSERT ON camera_image
WHEN NEW.file IS NOT NULL AND EXISTS (
  SELECT 1 FROM media_file WHERE storage = 'b2' AND object_key = NEW.file)
BEGIN
  SELECT RAISE(ABORT, 'camera_image.file is a photo''s file');
END;

CREATE TRIGGER camera_image_file_update
BEFORE UPDATE OF file ON camera_image
WHEN NEW.file IS NOT NULL AND EXISTS (
  SELECT 1 FROM media_file WHERE storage = 'b2' AND object_key = NEW.file)
BEGIN
  SELECT RAISE(ABORT, 'camera_image.file is a photo''s file');
END;

CREATE TRIGGER media_file_camera_image_insert
BEFORE INSERT ON media_file
WHEN NEW.storage = 'b2' AND EXISTS (
  SELECT 1 FROM camera_image WHERE file = NEW.object_key)
BEGIN
  SELECT RAISE(ABORT, 'media_file.object_key is a camera picture''s file');
END;

CREATE TRIGGER media_file_camera_image_update
BEFORE UPDATE OF storage, object_key ON media_file
WHEN NEW.storage = 'b2' AND EXISTS (
  SELECT 1 FROM camera_image WHERE file = NEW.object_key)
BEGIN
  SELECT RAISE(ABORT, 'media_file.object_key is a camera picture''s file');
END;
