-- Videos.
--
-- A video is a media row like a photo: the same path, visibility, public
-- id, metadata levels, tags, trash and status, and its pixel size in
-- media.width / height (0016). Its files are media_file rows (0013): the
-- original (role 'original', in B2, never served), a poster (role
-- 'poster', in B2: a JPEG frame the browser drew, which the image Worker
-- resizes for thumbnails and og cards like a photo) and the playback copy
-- (role 'play', storage 'r2', bucket `gallery-media-cache`: the original with
-- its metadata taken out, which is what plays). Both name the original as
-- their source_file_id. A multipart upload in progress keeps its id in
-- media_file.upload_id.
--
-- media.kind: 'image' (every existing row) or 'video'.
-- media.duration_ms: a video's length.
-- media.video_codec: the video track's codec as the file names it
--   ("avc1.640028", "hvc1", "vp09", …), for the admin; not public.
--
-- Columns are added in place (no rebuild: the triggers stay).
ALTER TABLE media ADD COLUMN kind TEXT NOT NULL DEFAULT 'image'
  CHECK (kind IN ('image', 'video'));
ALTER TABLE media ADD COLUMN duration_ms INTEGER CHECK (duration_ms >= 0);
ALTER TABLE media ADD COLUMN video_codec TEXT
  CHECK (length(video_codec) <= 64);

-- A video's resized copies and cards (0018, media.resized_at) are made from
-- its poster: a poster that becomes ready, stops being ready or goes puts
-- the video back to waiting, as a display copy does a photo (0018's
-- media_resized_display_* triggers). These name media.resized_at, which
-- 0018 adds: production has 0018 already, and on a new database 0018 runs
-- right after this (SQLite resolves a trigger's columns when it fires).
CREATE TRIGGER media_resized_poster_added
AFTER INSERT ON media_file
WHEN NEW.role = 'poster' AND NEW.status = 'ready'
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = NEW.media_id;
END;

CREATE TRIGGER media_resized_poster_changed
AFTER UPDATE OF status, role ON media_file
WHEN (NEW.role = 'poster' AND NEW.status = 'ready')
  IS NOT (OLD.role = 'poster' AND OLD.status = 'ready')
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = NEW.media_id;
END;

CREATE TRIGGER media_resized_poster_removed
AFTER DELETE ON media_file
WHEN OLD.role = 'poster' AND OLD.status = 'ready'
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = OLD.media_id;
END;
