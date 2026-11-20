-- Who took a VRChat photo, and what VRCX recorded with it.
--
-- media.world_author_id (0005) was filled from VRChat's XMP vrc:AuthorID,
-- which is the user who took the screenshot, not the world's author. It
-- becomes media.photographer_id (usr_…), with the photographer's display
-- name beside it (xmp:Author, or VRCX's author.displayName). Existing
-- values keep their meaning and move with the rename.
--
-- media.vrcx: what VRCX (https://github.com/vrcx-team/VRCX) wrote into
--   the PNG's "Description" text chunk, normalised (photo-meta.ts,
--   VrcxMeta): {"instance_id": "wrld_…:12345~friends(usr_…)~region(jp)",
--   "players": [{"id": "usr_…", "name": "…"}]}. Other people's names:
--   admin only, never public, never embedded.
--
-- None of these is public: the API Worker never selects them.
ALTER TABLE media RENAME COLUMN world_author_id TO photographer_id;
ALTER TABLE media ADD COLUMN photographer_name TEXT;
ALTER TABLE media ADD COLUMN vrcx TEXT
  CHECK (vrcx IS NULL OR (json_valid(vrcx) AND json_type(vrcx) = 'object'));
