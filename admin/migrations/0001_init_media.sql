-- Phase 1 schema: media metadata as the source of truth.
-- Mirrors MediaInfoJSON in src/components/gallery/types.ts.
-- tags are stored as a JSON array string; admin does not need per-tag queries yet.

CREATE TABLE media (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file         TEXT NOT NULL UNIQUE,
  world        TEXT NOT NULL CHECK (world IN ('Real','VRChat')),
  timestamp    TEXT,
  camera_make  TEXT,
  camera_model TEXT,
  tags         TEXT NOT NULL DEFAULT '[]',
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Pair invariant: rowToMediaJson collapses the exported camera object
  -- to null whenever either field is null, and validatePatch enforces
  -- the same rule at the API layer. This CHECK closes the gap for
  -- direct SQL writes (raw imports, manual fixups).
  CHECK ((camera_make IS NULL) = (camera_model IS NULL))
);

CREATE INDEX idx_media_world     ON media(world);
CREATE INDEX idx_media_timestamp ON media(timestamp DESC);
