-- Where a photo is shown, apart from where its file is; a trash; how much
-- of each photo's metadata is public; which tags are public; world
-- renamed to platform; legacy_index dropped.
--
-- media.file stays the B2 object key: set once by the upload (or by hand),
-- never changed. The image Worker, the API Worker, thumbnails and og cards
-- keep using it, so moving a photo in the admin never touches the bucket
-- and the image URLs of a photo do not change.
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

-- How much of a photo's metadata the public site shows, field by field
-- (file_name, taken_at, camera, tags; location, world and exif reserved),
-- each at a level from most to least (workers/api/src/metadata.ts has the
-- lists). The API Worker applies them to everything it returns.
-- media.metadata_visibility: this photo's overrides, a JSON object of
--   field → level; NULL or a missing field = the site's default.
-- setting: site-wide values by key. 'metadata_visibility' holds the
--   defaults, a JSON object of the same shape. These keep what the public
--   site showed so far, except the file name, which is hidden from now on.
ALTER TABLE media ADD COLUMN metadata_visibility TEXT
  CHECK (metadata_visibility IS NULL
         OR (json_valid(metadata_visibility)
             AND json_type(metadata_visibility) = 'object'));

CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO setting (key, value) VALUES ('metadata_visibility', json_object(
  'file_name', 'hidden', 'taken_at', 'second', 'camera', 'model',
  'tags', 'public', 'location', 'hidden', 'world', 'link', 'exif', 'basic'));

-- tag: every tag, and whether it is public. media.tags keeps the names (a
--   JSON array, as before); the public site only ever sees the tags marked
--   public here, and a name with no row is private. New tags are private.
--   The tags of the photos the public site shows now (public and unlisted)
--   are public already, so they start public; the rest start private.
CREATE TABLE tag (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 200),
  public     INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO tag (name, public)
SELECT DISTINCT j.value, 1 FROM media m, json_each(m.tags) j
WHERE json_valid(m.tags) AND j.type = 'text'
  AND m.status = 'ready' AND m.visibility IN ('public', 'unlisted')
  AND length(j.value) BETWEEN 1 AND 200
ORDER BY j.value;

-- Where a photo was taken (WGS 84 degrees), for a map later: both set or
-- both NULL. location_source says where it came from (the file's EXIF GPS
-- or entered by hand). Shown on the public site only as far as the
-- photo's `location` level allows (hidden by default). Nothing is filled
-- in here.
ALTER TABLE media ADD COLUMN latitude REAL
  CHECK (latitude BETWEEN -90 AND 90);
ALTER TABLE media ADD COLUMN longitude REAL
  CHECK ((latitude IS NULL) = (longitude IS NULL)
         AND (longitude IS NULL OR longitude BETWEEN -180 AND 180));
ALTER TABLE media ADD COLUMN location_source TEXT
  CHECK (location_source IN ('exif', 'manual'));

-- media.legacy_index (0003, the N of the first /photo/<N> URLs) is gone:
-- nothing links to those URLs any more.
DROP INDEX idx_media_legacy_index;
ALTER TABLE media DROP COLUMN legacy_index;

UPDATE media SET path = file;

CREATE UNIQUE INDEX idx_media_path_live ON media(path) WHERE trashed_at IS NULL;
CREATE INDEX        idx_media_trashed_at ON media(trashed_at);

CREATE TRIGGER media_path_default
AFTER INSERT ON media
WHEN NEW.path IS NULL
BEGIN
  UPDATE media SET path = NEW.file WHERE id = NEW.id;
END;
