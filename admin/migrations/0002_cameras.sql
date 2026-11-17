-- Cameras as their own records. A photo points at one camera (or none) via
-- media.camera_id; the exported media.json `camera` object and cameras.json
-- are both derived from the cameras row, so make/model live in exactly one
-- place. The old media.camera_make / camera_model columns are dropped below
-- (table rebuild — SQLite cannot drop a column that a CHECK names).

CREATE TABLE cameras (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- URL path segment on the public site (/camera/<slug>/). Lowercase
  -- ASCII letters, digits and '-' only; validateCamera enforces the exact
  -- shape (no leading/trailing/double '-').
  slug        TEXT NOT NULL UNIQUE
              CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT NOT NULL CHECK (name <> ''),
  make        TEXT,
  model       TEXT,
  -- NULL = not specified.
  kind        TEXT CHECK (kind IN ('digital','film','phone','virtual')),
  description TEXT,
  -- The maker's / shop's product page; http(s) only (validateCamera).
  product_url TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Pictures of the camera itself (not photos taken with it), in `position`
-- order. `file` is a bucket path like media.file (validateImageFile); the
-- admin has no upload yet, so the file is put in B2 by hand.
CREATE TABLE camera_images (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  file      TEXT NOT NULL CHECK (file <> ''),
  position  INTEGER NOT NULL DEFAULT 0,
  caption   TEXT,
  UNIQUE (camera_id, file)
);

CREATE INDEX idx_camera_images_camera ON camera_images(camera_id, position);

-- Backfill: one camera per distinct (camera_make, camera_model) pair. The
-- slug is the lowercased model with ' ', '/', '_' and '.' turned into '-'
-- (falls back to 'camera' if anything else is left), plus '-2', '-3', ...
-- when two pairs share it. A pair used only by VRChat photos is 'virtual';
-- anything else is left unspecified for the admin to fill in.
-- The suffix is not checked against other bases (models "Foo", "Foo" and
-- "Foo-2" would both yield "foo-2"); the UNIQUE constraint then fails the
-- whole migration, which D1 rolls back. The production data has a single
-- pair (logilabo / VirtualLens2), so this is not handled further.
INSERT INTO cameras (slug, name, make, model, kind)
SELECT
  CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END,
  make || ' ' || model,
  make,
  model,
  CASE WHEN only_vrchat THEN 'virtual' END
FROM (
  SELECT
    make,
    model,
    only_vrchat,
    base,
    row_number() OVER (PARTITION BY base ORDER BY make, model) AS rn
  FROM (
    SELECT
      make,
      model,
      only_vrchat,
      CASE
        WHEN raw = '' OR raw GLOB '*[^a-z0-9-]*' THEN 'camera'
        ELSE raw
      END AS base
    FROM (
      SELECT
        camera_make AS make,
        camera_model AS model,
        MIN(world = 'VRChat') AS only_vrchat,
        -- Then collapse runs of '-' (three passes: runs of up to 8) and
        -- trim them from both ends, so the slug passes CAMERA_SLUG_RE.
        trim(replace(replace(replace(
          lower(replace(replace(replace(replace(trim(camera_model),
            ' ', '-'), '/', '-'), '_', '-'), '.', '-')),
          '--', '-'), '--', '-'), '--', '-'), '-') AS raw
      FROM media
      WHERE camera_make IS NOT NULL AND camera_model IS NOT NULL
      GROUP BY camera_make, camera_model
    )
  )
)
ORDER BY make, model;

CREATE TABLE media_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file       TEXT NOT NULL UNIQUE,
  world      TEXT NOT NULL CHECK (world IN ('Real','VRChat')),
  timestamp  TEXT,
  -- No ON DELETE action: a camera that still has photos cannot be deleted.
  camera_id  INTEGER REFERENCES cameras(id),
  tags       TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO media_new (id, file, world, timestamp, camera_id, tags, updated_at)
SELECT m.id, m.file, m.world, m.timestamp, c.id, m.tags, m.updated_at
FROM media m
LEFT JOIN cameras c
  ON c.make = m.camera_make AND c.model = m.camera_model;

DROP TABLE media;
ALTER TABLE media_new RENAME TO media;

CREATE INDEX idx_media_world     ON media(world);
CREATE INDEX idx_media_timestamp ON media(timestamp DESC);
CREATE INDEX idx_media_camera_id ON media(camera_id);
