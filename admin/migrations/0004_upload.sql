-- Uploads from the admin, and folders that exist without files.
--
-- media.status: 'uploading' while the browser is still putting the file
--   into the bucket (the row is created first, so the path is reserved),
--   'ready' once the upload has completed. Only 'ready' rows are served by
--   the API Worker or listed as photos in the admin. The default is 'ready'
--   so existing rows and raw SQL inserts (files placed in B2 by hand) are
--   ready; the upload endpoint inserts 'uploading' explicitly.
-- media.size: the original's size in bytes, as declared by the uploader.
--   NULL for rows from before uploads.
-- media.sha256: lowercase hex SHA-256 of the original, computed in the
--   browser, to refuse uploading the same photo twice. Unique; NULL for
--   rows from before uploads (SQLite lets NULLs repeat in a UNIQUE index).
-- media.uploaded_at: when the upload completed (NULL before uploads).
--
-- Columns are added in place: no table rebuild, so 0003's public_id
-- triggers and indexes stay as they are.

ALTER TABLE media ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'
  CHECK (status IN ('uploading', 'ready'));

ALTER TABLE media ADD COLUMN size INTEGER CHECK (size >= 0);

ALTER TABLE media ADD COLUMN sha256 TEXT
  CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*');

ALTER TABLE media ADD COLUMN uploaded_at TEXT;

CREATE UNIQUE INDEX idx_media_sha256 ON media(sha256);
CREATE INDEX        idx_media_status ON media(status);

-- Folders created in the admin's Files view, so that a folder can exist
-- before anything is uploaded into it. Folders that contain files still
-- exist implicitly through media.file; a row here is only needed for an
-- empty one (and is harmless once files arrive). `path` has the shape of
-- media.file's directory part: "/VRChat/2026-11" (leading "/", no trailing
-- "/", segments of letters, digits, ".", "_", "-"; validateFolderPath in
-- src/lib/folders.ts has the exact rules). The root "/" is never stored.
-- Renaming and deleting folders are not supported yet.
CREATE TABLE folder (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL UNIQUE
             CHECK (path GLOB '/?*' AND path NOT GLOB '*/'
                    AND path NOT GLOB '*//*'
                    AND path NOT GLOB '*[^A-Za-z0-9._/-]*'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
