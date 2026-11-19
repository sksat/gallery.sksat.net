-- A photo's size in pixels, as it is displayed: after its EXIF orientation
-- (5–8 turn it a quarter, so width and height are the file's swapped).
-- The public gallery lays its tiles out at this aspect ratio before the
-- images load. (0012–0015 are taken by other changes in flight.)
--
-- media.width / height: NULL when unknown. Uploads set them from the
-- file's header (admin/src/lib/image-size.ts) and its orientation; the
-- metadata reader fills them for existing photos (the parser date was
-- bumped). Not a secret: anyone who can see the photo sees its size. The
-- same columns, with the same names, hold a video's size later.
--
-- Columns are added in place (no rebuild: the public_id triggers stay).
ALTER TABLE media ADD COLUMN width INTEGER CHECK (width > 0);
ALTER TABLE media ADD COLUMN height INTEGER CHECK (height > 0);
