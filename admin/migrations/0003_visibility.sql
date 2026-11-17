-- Per-photo visibility and a stable public URL id.
--
-- visibility: 'private' (admin only; the default for new photos),
--   'unlisted' (viewable by URL, never listed) or 'public'. Existing photos
--   that are in the production media.json (those that get a legacy_index
--   below) are already on the public site and become 'public'; the others
--   were never published and stay 'private'.
-- public_id: the photo's id on the public site (/photo/<public_id>). Set
--   once when the row is created and never changed (enforced by the
--   triggers below). 10 symbols from a 31-letter alphabet (lowercase +
--   digits without 0/o, 1/l/i): random, so unlisted photos cannot be found
--   by counting. The app generates it with crypto.getRandomValues
--   (src/lib/public-id.ts); SQLite's random() (seeded from OS entropy)
--   fills in the existing rows and any raw SQL insert that leaves it out.
-- legacy_index: the photo's position in the production media.json as of
--   this migration, i.e. the N of the old /photo/<N> URLs. Frozen: the
--   public site redirects /photo/<N> to /photo/<public_id> through it.
--
-- Columns are added in place (no table rebuild), so this migration does not
-- depend on the camera tables. SQLite cannot add a UNIQUE or NOT NULL
-- column without a constant default, so uniqueness comes from indexes and
-- "always set, never changed" from triggers. A later migration that
-- rebuilds `media` must recreate both triggers and indexes.

ALTER TABLE media ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'unlisted', 'public'));

ALTER TABLE media ADD COLUMN public_id TEXT
  CHECK (length(public_id) = 10
         AND public_id NOT GLOB '*[^23456789abcdefghjkmnpqrstuvwxyz]*');

ALTER TABLE media ADD COLUMN legacy_index INTEGER CHECK (legacy_index >= 0);

-- random() is evaluated per row.
UPDATE media SET public_id =
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
  substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1);

-- Order of https://sksat-gallery.s3.us-west-002.backblazeb2.com/media.json
-- when this migration was written (51 photos). Rows whose file is not in
-- the list get no legacy index.
WITH legacy(idx, file) AS (VALUES
  (0, '/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png'),
  (1, '/VRChat/2023-12/VRChat_2023-12-11_01-21-48.741_7680x4320.png'),
  (2, '/VRChat/2023-12/VRChat_2023-12-11_01-22-11.688_7680x4320.png'),
  (3, '/VRChat/2023-12/VRChat_2023-12-11_01-22-22.292_7680x4320.png'),
  (4, '/VRChat/2023-12/VRChat_2023-12-11_01-22-40.662_7680x4320.png'),
  (5, '/VRChat/2023-12/VRChat_2023-12-11_01-23-13.095_7680x4320.png'),
  (6, '/VRChat/2023-12/VRChat_2023-12-11_01-23-23.843_7680x4320.png'),
  (7, '/VRChat/2023-12/VRChat_2023-12-11_01-26-36.678_7680x4320.png'),
  (8, '/VRChat/2023-12/VRChat_2023-12-11_01-27-57.424_7680x4320.png'),
  (9, '/VRChat/2023-12/VRChat_2023-12-11_01-27-59.733_7680x4320.png'),
  (10, '/VRChat/2023-12/VRChat_2023-12-11_01-28-01.214_7680x4320.png'),
  (11, '/VRChat/2023-12/VRChat_2023-12-11_01-28-02.769_7680x4320.png'),
  (12, '/VRChat/2023-12/VRChat_2023-12-11_01-28-04.319_7680x4320.png'),
  (13, '/VRChat/2023-12/VRChat_2023-12-11_01-28-10.226_7680x4320.png'),
  (14, '/VRChat/2023-12/VRChat_2023-12-11_01-29-17.048_7680x4320.png'),
  (15, '/VRChat/2023-12/VRChat_2023-12-11_01-29-35.545_7680x4320.png'),
  (16, '/VRChat/2023-12/VRChat_2023-12-11_01-29-40.270_7680x4320.png'),
  (17, '/VRChat/2023-12/VRChat_2023-12-11_01-29-45.130_7680x4320.png'),
  (18, '/VRChat/2023-12/VRChat_2023-12-11_01-29-50.550_7680x4320.png'),
  (19, '/VRChat/2023-12/VRChat_2023-12-11_01-29-57.974_7680x4320.png'),
  (20, '/VRChat/2023-12/VRChat_2023-12-11_01-29-59.506_7680x4320.png'),
  (21, '/VRChat/2023-12/VRChat_2023-12-11_01-33-38.231_7680x4320.png'),
  (22, '/VRChat/2023-12/VRChat_2023-12-11_01-33-53.909_7680x4320.png'),
  (23, '/VRChat/2023-12/VRChat_2023-12-11_01-34-06.141_7680x4320.png'),
  (24, '/VRChat/2023-12/VRChat_2023-12-11_01-34-15.962_7680x4320.png'),
  (25, '/VRChat/2023-12/VRChat_2023-12-16_02-09-28.811_7680x4320.png'),
  (26, '/VRChat/2023-12/VRChat_2023-12-16_23-12-02.404_7680x4320.png'),
  (27, '/VRChat/2023-12/VRChat_2023-12-16_23-12-25.684_7680x4320.png'),
  (28, '/VRChat/2023-12/VRChat_2023-12-16_23-12-42.469_7680x4320.png'),
  (29, '/VRChat/2023-12/VRChat_2023-12-16_23-12-53.046_7680x4320.png'),
  (30, '/2023-12-comsys2023/1212816_0002.JPG'),
  (31, '/2023-12-comsys2023/1212816_0005.JPG'),
  (32, '/2023-12-comsys2023/1212816_0006.JPG'),
  (33, '/2023-12-comsys2023/1212816_0007.JPG'),
  (34, '/2023-12-comsys2023/1212816_0009.JPG'),
  (35, '/2023-12-comsys2023/1212816_0010.JPG'),
  (36, '/2023-12-comsys2023/1212816_0011.JPG'),
  (37, '/2023-12-comsys2023/1212816_0012.JPG'),
  (38, '/2023-12-comsys2023/1212816_0013.JPG'),
  (39, '/2023-12-comsys2023/1212816_0014.JPG'),
  (40, '/2023-12-comsys2023/1212816_0015.JPG'),
  (41, '/2023-12-comsys2023/1212816_0017.JPG'),
  (42, '/2023-12-comsys2023/1212816_0018.JPG'),
  (43, '/2023-12-comsys2023/1212816_0019.JPG'),
  (44, '/2023-12-comsys2023/1212816_0020.JPG'),
  (45, '/2023-12-comsys2023/1212816_0021.JPG'),
  (46, '/2023-12-comsys2023/1212816_0024.JPG'),
  (47, '/2023-12-comsys2023/1212816_0025.JPG'),
  (48, '/2023-12-comsys2023/1212816_0026.JPG'),
  (49, '/2023-12-comsys2023/1212816_0027.JPG'),
  (50, '/2023-12-comsys2023/1212816_0028.JPG')
)
UPDATE media
SET legacy_index = (SELECT idx FROM legacy WHERE legacy.file = media.file);

-- Only what the public site already shows starts as public; rows that were
-- never published keep the 'private' default.
UPDATE media SET visibility = 'public' WHERE legacy_index IS NOT NULL;

CREATE UNIQUE INDEX idx_media_public_id    ON media(public_id);
CREATE UNIQUE INDEX idx_media_legacy_index ON media(legacy_index);
CREATE INDEX        idx_media_visibility   ON media(visibility);

-- A row inserted without a public id gets one.
CREATE TRIGGER media_public_id_default
AFTER INSERT ON media
WHEN NEW.public_id IS NULL
BEGIN
  UPDATE media SET public_id =
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1) ||
    substr('23456789abcdefghjkmnpqrstuvwxyz', abs(random() % 31) + 1, 1)
  WHERE id = NEW.id;
END;

-- Once set, a public id never changes (not even to NULL): shared URLs must
-- keep pointing at the same photo.
CREATE TRIGGER media_public_id_fixed
BEFORE UPDATE OF public_id ON media
WHEN OLD.public_id IS NOT NULL AND NEW.public_id IS NOT OLD.public_id
BEGIN
  SELECT RAISE(ABORT, 'media.public_id cannot be changed');
END;
