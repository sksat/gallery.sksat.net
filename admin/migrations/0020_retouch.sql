-- Retouched versions of a photo (media_file role 'edit', 0013) can be
-- removed, and a photo uploaded on its own that is a retouch of another
-- can be merged into it. (0017 is taken by another change in flight.)
--
-- media_file.trashed_at: when an edit was removed (NULL = not removed).
-- A removed edit stays in the bucket and in D1 until it is deleted for
-- good from the trash; it is never the file its photo shows. Only edits
-- are removed this way (an original goes with its photo, a copy with the
-- file it was made from).
ALTER TABLE media_file ADD COLUMN trashed_at TEXT;

-- The removed edits, for the trash (few rows).
CREATE INDEX idx_media_file_trashed ON media_file(trashed_at)
  WHERE trashed_at IS NOT NULL;

-- The file a photo shows is not a removed one (0013's trigger, with that
-- condition added).
DROP TRIGGER media_active_file_update;
CREATE TRIGGER media_active_file_update
BEFORE UPDATE OF active_file_id ON media
WHEN NEW.active_file_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_file f
  WHERE f.id = NEW.active_file_id AND f.media_id = NEW.id
    AND f.role IN ('original', 'edit') AND f.status = 'ready'
    AND f.trashed_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'media.active_file_id must be a ready original or edit of the photo');
END;

CREATE TRIGGER media_file_trash_guard
BEFORE UPDATE OF trashed_at ON media_file
WHEN NEW.trashed_at IS NOT NULL AND (OLD.role <> 'edit'
  OR EXISTS (SELECT 1 FROM media WHERE active_file_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'only an edit its photo does not show can be removed');
END;

CREATE TRIGGER media_file_trash_insert
BEFORE INSERT ON media_file
WHEN NEW.trashed_at IS NOT NULL AND NEW.role <> 'edit'
BEGIN
  SELECT RAISE(ABORT, 'only an edit can be removed');
END;

-- media_alias: the public id of a photo merged into another one (its file
-- became a retouched version of that photo, its row went away). Public ids
-- never change and shared links keep working: /photo/<public_id>/ of a
-- merged photo that could be opened then (public or unlisted: `redirect`)
-- redirects to the photo it went into (the API Worker answers that photo
-- for it). A private one's id was never a working link and stays 404.
-- `merged` is what undoing the merge needs (the merged photo's row and
-- files as they were, and what the merge changed on the other photo);
-- admin only, never public.
CREATE TABLE media_alias (
  public_id  TEXT PRIMARY KEY
             CHECK (length(public_id) = 10
                    AND public_id NOT GLOB '*[^23456789abcdefghjkmnpqrstuvwxyz]*'),
  media_id   INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  redirect   INTEGER NOT NULL DEFAULT 1 CHECK (redirect IN (0, 1)),
  merged     TEXT CHECK (merged IS NULL
               OR (json_valid(merged) AND json_type(merged) = 'object')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A photo's aliases (moved along when it is merged itself, and the ON
-- DELETE CASCADE).
CREATE INDEX idx_media_alias_media ON media_alias(media_id);

-- A public id is a photo's or an alias, never both.
CREATE TRIGGER media_alias_unique_insert
BEFORE INSERT ON media_alias
WHEN EXISTS (SELECT 1 FROM media WHERE public_id = NEW.public_id)
BEGIN
  SELECT RAISE(ABORT, 'media_alias.public_id is a photo''s public id');
END;

CREATE TRIGGER media_public_id_not_alias
BEFORE INSERT ON media
WHEN NEW.public_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM media_alias WHERE public_id = NEW.public_id)
BEGIN
  SELECT RAISE(ABORT, 'media.public_id is an alias');
END;
