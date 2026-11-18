-- Where a photo is shown, apart from where its file is; a trash; whether
-- its file name is public; world renamed to platform.
--
-- media.file stays the B2 object key: set once by the upload (or by hand),
-- never changed. The image Worker, the API Worker, thumbnails and og cards
-- keep using it, so moving a photo in the admin never touches the bucket
-- and old /img/<preset>/<file> URLs keep working.
-- media.path is the photo's place in the admin's folders ("/VRChat/2026-11/
--   a.png"): the Files view, search and the lists use it, and moving or
--   renaming a photo or folder rewrites it. Same shape as file (leading
--   "/", segments of [A-Za-z0-9._-]; validated in the app). Rows get
--   path = file: existing ones below, new ones from the trigger when an
--   INSERT leaves it out (raw SQL; the app sets it).
-- media.trashed_at: when the photo went to the trash (NULL = not trashed).
--   Trashed photos are hidden from the public site (the API Worker treats
--   them like private ones) and from the admin's lists; they keep their
--   path so that restoring puts them back. Deleting one for good removes
--   its B2 object (every version) and then the row.
--
-- A path belongs to at most one photo that is not trashed (partial unique
-- index), so a trashed photo does not block its old place.
-- Columns are added in place; 0003's public_id triggers stay.

-- media.world → media.platform: where the photo was taken ('Real',
--   'VRChat'; later e.g. 'Resonite'). "world" is kept for the actual
--   VRChat world a photo was taken in. SQLite carries the rename into the
--   column's CHECK; the index gets the new name too.
ALTER TABLE media RENAME COLUMN world TO platform;
DROP INDEX idx_media_world;
CREATE INDEX idx_media_platform ON media(platform);

ALTER TABLE media ADD COLUMN path TEXT
  CHECK (path GLOB '/?*' AND path NOT GLOB '*/' AND path NOT GLOB '*//*');

ALTER TABLE media ADD COLUMN trashed_at TEXT;

-- media.filename_public: whether the photo's file name may be shown on the
--   public site, apart from its visibility. 0 (the default, existing photos
--   included): the API Worker never returns the name and the image Worker
--   serves the photo only by public id (/img/<preset>/<public_id>), not by
--   its bucket path. 1: the name is returned and /img/<preset>/<file> works.
ALTER TABLE media ADD COLUMN filename_public INTEGER NOT NULL DEFAULT 0
  CHECK (filename_public IN (0, 1));

UPDATE media SET path = file;

CREATE UNIQUE INDEX idx_media_path_live ON media(path) WHERE trashed_at IS NULL;
CREATE INDEX        idx_media_trashed_at ON media(trashed_at);

CREATE TRIGGER media_path_default
AFTER INSERT ON media
WHEN NEW.path IS NULL
BEGIN
  UPDATE media SET path = NEW.file WHERE id = NEW.id;
END;
