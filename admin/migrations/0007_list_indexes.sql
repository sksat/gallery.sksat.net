-- Indexes for how the admin reads `media`, so that its frequent queries
-- read a few index entries instead of the whole table (D1 bills rows read).
--
-- Most queries list the admin's photos (LIVE_PHOTO: status = 'ready' AND
-- trashed_at IS NULL) by date or by path. A partial index on that
-- condition in date order lets the edit page's prev/next
-- (src/lib/neighbors.ts) be keyset lookups and its counts read only the
-- index. A query uses a partial index only when its WHERE has both terms
-- as written below. platform and visibility (the list filters) are in it
-- so that filtered counts never touch the table.
--
-- The single-column indexes on status, trashed_at, visibility, platform and
-- timestamp go: with a handful of distinct values they select little, but
-- SQLite (without ANALYZE statistics) prefers an equality on any of them
-- to the indexes here and then sorts the whole list. Their remaining uses
-- get partial indexes of their own.
--
-- Indexes only, on columns up to 0005.

DROP INDEX idx_media_status;
DROP INDEX idx_media_trashed_at;
DROP INDEX idx_media_visibility;
DROP INDEX idx_media_platform;
DROP INDEX idx_media_timestamp;

-- The list view (and the API's list): timestamp DESC, id DESC, undated
-- last.
CREATE INDEX idx_media_live_timestamp
  ON media(timestamp, id, platform, visibility)
  WHERE status = 'ready' AND trashed_at IS NULL;

-- The files view walks idx_media_path_live (0005), a folder being a range
-- of path.

-- Uploads that never completed (the Files view lists them).
CREATE INDEX idx_media_uploading
  ON media(path)
  WHERE status = 'uploading' AND trashed_at IS NULL;

-- The trash.
CREATE INDEX idx_media_trashed
  ON media(trashed_at)
  WHERE trashed_at IS NOT NULL;
