-- Resized copies and social cards of a photo, made once and kept in the R2
-- bucket gallery-media-cache (binding MEDIA_CACHE), so that serving a
-- photo does not ask Cloudflare Image Transformations again (5,000 unique
-- transformations a month on the Free plan, used up by ~1,500 photos at
-- six sizes, and each presign window may count again). The image Worker
-- has Image Transformations make them, once per file and preset (its cron
-- and at upload), or the admin's browser makes them; the Worker serves
-- them from the bucket and asks Image Transformations only for a photo
-- whose copies are not made yet. (0017 is taken by another change in
-- flight.)
--
-- media.resized_at: where a photo's copies stand, and the one claim both
-- makers take (../shared/resized/claim.ts):
--   NULL                waiting (never made, or the file to resize changed:
--                       the triggers below)
--   <ISO time>          made; waiting again once older than RESIZED_DATE
--   'making:<time>'     claimed; taken again after a while (a tab that
--                       went away, a cron run that died)
--   'failed:<time>'     could not be made now (the quota, an outage, a
--                       browser out of memory); waiting again a day later
--   'browser:<time>'    Image Transformations cannot make it (a file it
--                       refuses): left to the admin's browser
--
-- The copies themselves are only in the bucket, under
-- img/<public_id><key of the file they were made from>/<preset>: no row
-- per copy (they can be made again at any time, and the image Worker,
-- which makes most of them, has no D1 binding). Nothing here changes what
-- the public API answers.
ALTER TABLE media ADD COLUMN resized_at TEXT;
-- The photos waiting for their copies (a range per state, like
-- idx_media_metadata_read_at).
CREATE INDEX idx_media_resized_at ON media(resized_at);

-- The file to resize changes: its copies are made again (from that file;
-- the old ones are removed when the new ones are stored).
CREATE TRIGGER media_resized_shown_changed
AFTER UPDATE OF active_file_id ON media
WHEN NEW.active_file_id IS NOT OLD.active_file_id
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = NEW.id;
END;

CREATE TRIGGER media_resized_display_added
AFTER INSERT ON media_file
WHEN NEW.role = 'display' AND NEW.status = 'ready'
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = NEW.media_id;
END;

CREATE TRIGGER media_resized_display_changed
AFTER UPDATE OF status, role ON media_file
WHEN (NEW.role = 'display' AND NEW.status = 'ready')
  IS NOT (OLD.role = 'display' AND OLD.status = 'ready')
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = NEW.media_id;
END;

CREATE TRIGGER media_resized_display_removed
AFTER DELETE ON media_file
WHEN OLD.role = 'display' AND OLD.status = 'ready'
BEGIN
  UPDATE media SET resized_at = NULL WHERE id = OLD.media_id;
END;
