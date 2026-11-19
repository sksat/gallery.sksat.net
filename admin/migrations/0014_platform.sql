-- Platforms as rows: where a photo was taken, editable on the admin's
-- /platform/ page instead of fixed to 'Real' / 'VRChat' by a CHECK.
-- (0010–0013 are taken by other changes in progress.)
--
-- platform.key: what media.platform stores; set once when the platform is
--   added and never changed (the admin's ?platform= URLs carry it). The
--   two existing values are kept as keys, so no photo is rewritten.
-- platform.name: what the admin and the public site show (the public
--   site's tag filter uses it); renaming changes only this.
-- platform.kind: 'real' (the real world) or 'virtual' (a VR platform: no
--   real-world position, so no map or location picker in the admin and no
--   location from the API), as VRChat has been.
-- platform.position: the order of the admin's lists.
--
-- What is VRChat's own (its world fields and link, its XMP, its file
-- names) stays tied to the key 'VRChat' in code.
CREATE TABLE platform (
  key      TEXT PRIMARY KEY
           CHECK (length(key) BETWEEN 1 AND 32
                  AND key GLOB '[A-Za-z0-9]*'
                  AND key NOT GLOB '*[^A-Za-z0-9_-]*'),
  name     TEXT NOT NULL UNIQUE COLLATE NOCASE
           CHECK (length(name) BETWEEN 1 AND 40 AND name = trim(name)),
  kind     TEXT NOT NULL CHECK (kind IN ('real', 'virtual')),
  position INTEGER NOT NULL
);

INSERT INTO platform (key, name, kind, position) VALUES
  ('Real', 'Real', 'real', 0),
  ('VRChat', 'VRChat', 'virtual', 1);

-- media.platform: its CHECK (0001) cannot be dropped in SQLite, and
-- rebuilding `media` would mean recreating its triggers and indexes and
-- rewriting every row. So the column is swapped, as 0009 does for
-- camera.kind: renamed, a new one added that refers to platform(key),
-- copied, the old one dropped. A platform therefore cannot be deleted
-- while a photo uses it.
--
-- idx_media_live_timestamp (0007) is the only thing that names the column
-- (no trigger or view does), and a column in an index cannot be dropped:
-- it is dropped first and recreated exactly as 0007 made it.
--
-- An added column that has REFERENCES must default to NULL, and a NOT NULL
-- or CHECK on it would be tested against the existing rows (all NULL then),
-- so the triggers below keep it from ever being NULL instead.
DROP INDEX idx_media_live_timestamp;
ALTER TABLE media RENAME COLUMN platform TO platform_before_0014;
ALTER TABLE media ADD COLUMN platform TEXT REFERENCES platform(key);
UPDATE media SET platform = platform_before_0014;
ALTER TABLE media DROP COLUMN platform_before_0014;

CREATE INDEX idx_media_live_timestamp
  ON media(timestamp, id, platform, visibility)
  WHERE status = 'ready' AND trashed_at IS NULL;

CREATE TRIGGER media_platform_required_insert
BEFORE INSERT ON media
WHEN NEW.platform IS NULL
BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: media.platform');
END;

CREATE TRIGGER media_platform_required_update
BEFORE UPDATE OF platform ON media
WHEN NEW.platform IS NULL
BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: media.platform');
END;
