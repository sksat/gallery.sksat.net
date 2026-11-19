-- The files of a photo. A photo (a `media` row: its public id, visibility,
-- tags and shooting information) can have several files: the original,
-- retouched versions of it (Lightroom, ON1, ...), and copies made for
-- showing it (a display copy of a large image, a video's poster and
-- playback copy). Each is a media_file row.
--
-- media_file.role: what the file is for.
--   original  the file as it was taken or scanned (one per photo)
--   edit      a retouched version (any number; source_file_id = what it
--             was made from, when known)
--   display   a copy to resize and show instead of source_file_id (an image
--             over the resize limits)
--   poster    a still of a video (source_file_id = the video)
--   play      a copy of a video to play (source_file_id = the video)
-- media_file.storage / object_key: where it is ('b2' now; 'r2' later) and
--   its key there, "/VRChat/2023-12/a.png" like media.file. Never changes.
-- media_file.source_file_id: what it was made from (provenance; role says
--   what it is for). A file of the same photo; required for display,
--   poster and play, never set on an original.
-- media_file.status: 'uploading' until the bucket has it, 'ready', or
--   'failed'. upload_id: the S3 multipart upload id while it is uploading
--   in parts (NULL otherwise), so it can be resumed or aborted.
-- media_file.size / sha256 / mime_type: the object's. sha256 is unique
--   across every file of every photo (the uploader refuses a duplicate).
-- media_file.file_exif: the file's own EXIF as read (0009's shape).
--   creator_tool: the program that wrote it (XMP xmp:CreatorTool, else
--   EXIF Software). xmp_summary: a small JSON summary of its XMP (the
--   develop settings crs:* it has, and the last steps of xmpMM:History).
--   Admin only, never public. An edit's metadata stays on its row: the
--   photo's shooting information (media.exif, timestamp, camera_id, ...)
--   comes from the original and from the admin only.
-- media_file.metadata_read_at: like media.metadata_read_at (0005/0008).
--
-- media.active_file_id: the file the public site shows, chosen per photo:
--   the original or any one of its edits, ready. NULL = the original. The
--   image Worker resizes that file, or its newest ready display copy when
--   it has one.
--
-- During the move to media_file, media keeps its file columns: media.file,
-- status, size, sha256, file_exif, metadata_read_at and uploaded_at stay
-- the original's, as the admin's lists, uploads and the metadata reader
-- read and write them. The triggers below keep the original's media_file
-- row the same: an INSERT INTO media creates it in the same statement
-- (uploads, raw SQL, test fixtures), an UPDATE of those columns copies
-- them. Write the original through media until those columns go.

CREATE TABLE media_file (
  id               INTEGER PRIMARY KEY,
  media_id         INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  role             TEXT NOT NULL
                   CHECK (role IN ('original', 'edit', 'display', 'poster', 'play')),
  storage          TEXT NOT NULL DEFAULT 'b2' CHECK (storage IN ('b2', 'r2')),
  -- Only the leading "/" is checked: media.file never had a shape CHECK,
  -- and the backfill below must take every existing key.
  object_key       TEXT NOT NULL CHECK (object_key GLOB '/?*'),
  source_file_id   INTEGER REFERENCES media_file(id),
  status           TEXT NOT NULL DEFAULT 'uploading'
                   CHECK (status IN ('uploading', 'ready', 'failed')),
  upload_id        TEXT CHECK (upload_id IS NULL OR status = 'uploading'),
  size             INTEGER CHECK (size >= 0),
  sha256           TEXT
                   CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  mime_type        TEXT,
  file_exif        TEXT CHECK (file_exif IS NULL
                     OR (json_valid(file_exif) AND json_type(file_exif) = 'object')),
  creator_tool     TEXT,
  xmp_summary      TEXT CHECK (xmp_summary IS NULL
                     OR (json_valid(xmp_summary) AND json_type(xmp_summary) = 'object')),
  metadata_read_at TEXT,
  uploaded_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (storage, object_key),
  CHECK (CASE role
           WHEN 'original' THEN source_file_id IS NULL
           WHEN 'edit' THEN 1
           ELSE source_file_id IS NOT NULL
         END)
);

-- One original per photo (also its lookup by photo).
CREATE UNIQUE INDEX idx_media_file_original ON media_file(media_id)
  WHERE role = 'original';
-- A photo's files by role (and the ON DELETE CASCADE from media).
CREATE INDEX idx_media_file_media ON media_file(media_id, role, id);
-- What was made from a file: its display copy (the image Worker's lookup).
CREATE INDEX idx_media_file_source ON media_file(source_file_id, role);
-- The same bytes are never uploaded twice, whatever the role.
CREATE UNIQUE INDEX idx_media_file_sha256 ON media_file(sha256);
-- Edits waiting for the metadata reader (originals wait through media).
CREATE INDEX idx_media_file_edit_read ON media_file(metadata_read_at)
  WHERE role = 'edit' AND status = 'ready';

ALTER TABLE media ADD COLUMN active_file_id INTEGER REFERENCES media_file(id);
-- The few photos that show another file (also the foreign key's lookup
-- when a media_file row is deleted).
CREATE INDEX idx_media_active_file ON media(active_file_id)
  WHERE active_file_id IS NOT NULL;

-- Every photo's file so far is its original.
INSERT INTO media_file (media_id, role, storage, object_key, status, size,
  sha256, mime_type, file_exif, metadata_read_at, uploaded_at, created_at)
SELECT id, 'original', 'b2', file, status, size, sha256,
  CASE WHEN lower(file) GLOB '*.png' THEN 'image/png'
       WHEN lower(file) GLOB '*.jp*g' THEN 'image/jpeg' END,
  file_exif, metadata_read_at, uploaded_at,
  COALESCE(uploaded_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM media ORDER BY id;

-- A new photo's original, in the same statement as the photo.
CREATE TRIGGER media_file_original_insert
AFTER INSERT ON media
BEGIN
  INSERT INTO media_file (media_id, role, storage, object_key, status, size,
    sha256, mime_type, file_exif, metadata_read_at, uploaded_at)
  VALUES (NEW.id, 'original', 'b2', NEW.file, NEW.status, NEW.size,
    NEW.sha256,
    CASE WHEN lower(NEW.file) GLOB '*.png' THEN 'image/png'
         WHEN lower(NEW.file) GLOB '*.jp*g' THEN 'image/jpeg' END,
    NEW.file_exif, NEW.metadata_read_at, NEW.uploaded_at);
END;

-- The original's columns follow media's (only when one of them changed,
-- so other edits of a photo write nothing here). A completed upload
-- leaves no multipart upload id.
CREATE TRIGGER media_file_original_sync
AFTER UPDATE OF file, status, size, sha256, file_exif, metadata_read_at,
  uploaded_at ON media
WHEN NEW.file IS NOT OLD.file OR NEW.status IS NOT OLD.status
  OR NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256
  OR NEW.file_exif IS NOT OLD.file_exif
  OR NEW.metadata_read_at IS NOT OLD.metadata_read_at
  OR NEW.uploaded_at IS NOT OLD.uploaded_at
BEGIN
  UPDATE media_file SET
    object_key = NEW.file, status = NEW.status, size = NEW.size,
    sha256 = NEW.sha256, file_exif = NEW.file_exif,
    metadata_read_at = NEW.metadata_read_at, uploaded_at = NEW.uploaded_at,
    upload_id = CASE WHEN NEW.status = 'uploading' THEN upload_id END
  WHERE media_id = NEW.id AND role = 'original';
END;

-- The file a photo shows is a ready original or edit of that photo.
CREATE TRIGGER media_active_file_insert
BEFORE INSERT ON media
WHEN NEW.active_file_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'media.active_file_id must be a ready original or edit of the photo');
END;

CREATE TRIGGER media_active_file_update
BEFORE UPDATE OF active_file_id ON media
WHEN NEW.active_file_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_file f
  WHERE f.id = NEW.active_file_id AND f.media_id = NEW.id
    AND f.role IN ('original', 'edit') AND f.status = 'ready')
BEGIN
  SELECT RAISE(ABORT, 'media.active_file_id must be a ready original or edit of the photo');
END;

-- ... and stays one while it is shown.
CREATE TRIGGER media_file_active_guard
BEFORE UPDATE OF media_id, role, status ON media_file
WHEN (NEW.media_id IS NOT OLD.media_id
      OR NEW.role NOT IN ('original', 'edit') OR NEW.status <> 'ready')
  AND EXISTS (SELECT 1 FROM media WHERE active_file_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'media_file is the file its photo shows');
END;

-- A file is made from a file of the same photo.
CREATE TRIGGER media_file_source_insert
BEFORE INSERT ON media_file
WHEN NEW.source_file_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_file s
  WHERE s.id = NEW.source_file_id AND s.media_id = NEW.media_id)
BEGIN
  SELECT RAISE(ABORT, 'media_file.source_file_id must be a file of the same photo');
END;

CREATE TRIGGER media_file_source_update
BEFORE UPDATE OF source_file_id, media_id ON media_file
WHEN NEW.source_file_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_file s
  WHERE s.id = NEW.source_file_id AND s.media_id = NEW.media_id)
BEGIN
  SELECT RAISE(ABORT, 'media_file.source_file_id must be a file of the same photo');
END;

-- A file moved to another photo leaves nothing made from it behind (move
-- or delete those first: a copy can be made again).
CREATE TRIGGER media_file_source_moved
BEFORE UPDATE OF media_id ON media_file
WHEN NEW.media_id IS NOT OLD.media_id AND EXISTS (
  SELECT 1 FROM media_file d
  WHERE d.source_file_id = OLD.id AND d.media_id IS NOT NEW.media_id)
BEGIN
  SELECT RAISE(ABORT, 'media_file has files made from it in its photo');
END;
