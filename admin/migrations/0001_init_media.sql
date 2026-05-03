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
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_media_world     ON media(world);
CREATE INDEX idx_media_timestamp ON media(timestamp DESC);
