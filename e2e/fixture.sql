-- Deterministic fixture for the gallery's E2E and VRT, loaded into the
-- local D1 behind the API Worker (e2e/start-api-server.sh). Mirrors
-- public/test-media (see the README there): five public photos with fixed
-- public ids, plus one unlisted and one private photo that must never show
-- up in lists.
--
-- The public ids are hand-made so tests can name a photo: 10 characters
-- from the real alphabet (23456789abcdefghjkmnpqrstuvwxyz), padded with
-- "x". The prefix says what the photo is and the last letter which one:
--   rea… = /mock/realN.png    (reaxxxxxxa = real1, reaxxxxxxb = real2)
--   vrc… = /mock/vrchatN.png  (vrcxxxxxxa = vrchat1 … vrcxxxxxxc = vrchat3)
--   unxxxxxxxx = the unlisted photo, pvxxxxxxxx = the private one
-- Letters, not digits, count the photos because 0 and 1 are not in the
-- alphabet.
INSERT INTO camera (id, slug, name, manufacturer, manufacturer_url, model, kind, description, product_url) VALUES
  (1, 'pentax-sp',    'PENTAX SP',    'Asahi',    NULL,                           'Pentax SP',    'film',    NULL, NULL),
  (2, 'virtuallens2', 'VirtualLens2', 'logilabo', 'https://example.com/logilabo', 'VirtualLens2', 'virtual', 'Virtual camera for VRChat.' || char(10) || 'Second line of the description.', 'https://example.com/virtuallens2');
-- The cameras' own tags (kept to themselves: the photos' tags stay as
-- they are). The camera pages link them to the gallery.
INSERT INTO camera_tag (camera_id, tag, propagate, position) VALUES
  (1, 'film', 0, 0),
  (2, 'VRChat', 0, 0);
INSERT INTO camera_image (camera_id, file, position, caption) VALUES
  (2, '/camera/virtuallens2/front.png', 0, 'Front'),
  (2, '/camera/virtuallens2/ui.png',    1, NULL),
  (2, '/camera/virtuallens2/side.png',  2, 'Side');
INSERT INTO media (id, public_id, file, platform, timestamp, camera_id, tags, visibility) VALUES
  (1, 'reaxxxxxxa', '/mock/real1.png',    'Real',   '2023-12-01T00:00:00Z', 1,    '["film"]',           'public'),
  (2, 'vrcxxxxxxa', '/mock/vrchat1.png',  'VRChat', '2023-12-02T00:00:00Z', 2,    '["VRChat"]',         'public'),
  (3, 'reaxxxxxxb', '/mock/real2.png',    'Real',   '2023-12-03T00:00:00Z', NULL, '["night"]',          'public'),
  (4, 'vrcxxxxxxb', '/mock/vrchat2.png',  'VRChat', '2023-12-04T12:34:56+09:00', NULL, '["VRChat","night"]', 'public'),
  (5, 'vrcxxxxxxc', '/mock/vrchat3.png',  'VRChat', '2023-12-05T00:00:00Z', 2,    '["VRChat","draft"]', 'public'),
  (6, 'unxxxxxxxx', '/mock/unlisted.png', 'VRChat', '2023-12-06T00:00:00Z', 2,    '["VRChat","night"]', 'unlisted'),
  (7, 'pvxxxxxxxx', '/mock/private.png',  'Real',   '2023-12-07T00:00:00Z', NULL, '["secret"]',         'private');
-- Platforms (admin migration 0014 seeds Real and VRChat): vrcxxxxxxc is on
-- one the owner added, "Neos VR" (a VRChat-looking file that was really a
-- Neos VR screenshot). It keeps its "VRChat" tag, so the tag counts below
-- stay as they were and "Neos VR" is one more tag with one photo.
INSERT INTO platform (key, name, kind, position) VALUES
  ('Neos-VR', 'Neos VR', 'virtual', 2);
UPDATE media SET platform = 'Neos-VR' WHERE id = 5;
-- Tags: "draft" (on vrchat3) and "secret" are private; the API never
-- returns them.
INSERT INTO tag (name, public) VALUES
  ('film', 1), ('VRChat', 1), ('night', 1), ('draft', 0), ('secret', 0);
-- Metadata visibility (the site default hides file names):
-- - every file name is public with its folder, except reaxxxxxxb's
--   (/mock/real2.png): the API leaves it out, so without the image Worker
--   (tests) the gallery shows a grey stand-in for it;
-- - vrcxxxxxxb shows only the date it was taken (2023/12/04, in its own
--   +09:00 offset).
UPDATE media SET metadata_visibility = '{"file_name":"path"}' WHERE id <> 3;
UPDATE media SET metadata_visibility = '{"file_name":"path","taken_at":"date"}' WHERE id = 4;
-- The info panel of the photo overlay (e2e/info-panel.spec.ts) shows
-- exactly what the API returns; these rows cover each level:
-- - vrcxxxxxxa: everything (time to the second, camera with its page, the
--   world with its link, every EXIF value; its location level is exact,
--   but VRChat photos have no real-world place, so the API leaves it out);
-- - vrcxxxxxxb: the date only, the camera's maker only (RICOH), the world
--   name without a link, and its EXIF hidden;
-- - reaxxxxxxb: its camera hidden and the basic EXIF only (no lens, body
--   or file name);
-- - reaxxxxxxa: the time to the minute.
-- Camera 3 is never shown at the "model" level, so it has no page and is
-- not in the camera list.
INSERT INTO camera (id, slug, name, manufacturer, manufacturer_url, model, kind, description, product_url) VALUES
  (3, 'ricoh-gr3', 'GR III', 'RICOH', NULL, 'GR III', 'digital', NULL, NULL);
UPDATE media SET
  world_id = 'wrld_0123abcd-4567-89ab-cdef-0123456789ab',
  world_name = 'Fixture World',
  exif = '{"make":"Canon","model":"EOS R5","lens":"RF35mm F1.8 MACRO IS STM","f_number":2.8,"exposure_time":"1/250","iso":100,"focal_length_mm":35,"taken_at_original":"2023-12-02T09:00:00+09:00"}',
  latitude = 35.681236, longitude = 139.767125,
  metadata_visibility = '{"file_name":"path","exif":"all","location":"exact"}'
  WHERE id = 2;
UPDATE media SET
  camera_id = 3,
  world_id = 'wrld_fedcba98-7654-3210-fedc-ba9876543210',
  world_name = 'Name Only World',
  exif = '{"f_number":4,"exposure_time":"1/60","iso":800}',
  metadata_visibility = '{"file_name":"path","taken_at":"date","camera":"manufacturer","world":"name","exif":"hidden"}'
  WHERE id = 4;
UPDATE media SET
  camera_id = 3,
  exif = '{"make":"RICOH","model":"GR III","lens":"GR LENS 18.3mm","f_number":5.6,"exposure_time":"1/1000","iso":200,"focal_length_mm":18.3}',
  metadata_visibility = '{"camera":"hidden"}'
  WHERE id = 3;
UPDATE media SET
  metadata_visibility = '{"file_name":"path","taken_at":"minute"}'
  WHERE id = 1;
-- Where they were taken (the map; locations are hidden by default):
-- - reaxxxxxxa at its exact position (Tokyo Station);
-- - reaxxxxxxb only to the city (35.66, 139.70: an area, not a pin);
-- - vrcxxxxxxa has a position with an exact level, but VRChat photos are
--   left off the map;
-- - the private photo's position is public by its level, but it is private;
-- - vrcxxxxxxc has a position that stays hidden (the default level).
UPDATE media SET latitude = 35.681236, longitude = 139.767125, location_source = 'exif',
  metadata_visibility = json_set(metadata_visibility, '$.location', 'exact') WHERE id = 1;
UPDATE media SET latitude = 35.658034, longitude = 139.701636, location_source = 'manual',
  metadata_visibility = json_set(metadata_visibility, '$.location', 'city') WHERE id = 3;
UPDATE media SET latitude = 35.0, longitude = 135.0, location_source = 'manual',
  metadata_visibility = json_set(metadata_visibility, '$.location', 'exact') WHERE id IN (2, 7);
UPDATE media SET latitude = 34.702485, longitude = 135.495951, location_source = 'manual' WHERE id = 5;
-- Fields of tags (admin migration 0010):
-- - film (public) has 銘柄, ISO (shown) and ラボ (hidden by default);
--   reaxxxxxxa has all three, so it shows 銘柄 and ISO under 「film」;
-- - draft and secret are private: their fields' values (on vrcxxxxxxc and
--   the private photo) are never returned.
INSERT INTO tag_field (id, tag_id, label, type, options, position, visibility)
  SELECT 1, id, '銘柄', 'select', '["Kodak Portra 400","Ilford HP5 Plus"]', 0, 'shown' FROM tag WHERE name = 'film';
INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
  SELECT 2, id, 'ISO', 'number', 1, 'shown' FROM tag WHERE name = 'film';
INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
  SELECT 3, id, 'ラボ', 'text', 2, 'hidden' FROM tag WHERE name = 'film';
INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
  SELECT 4, id, 'メモ', 'text', 0, 'shown' FROM tag WHERE name = 'draft';
UPDATE media SET tag_values = '{"1":"Kodak Portra 400","2":400,"3":"Fixture Lab"}' WHERE id = 1;
UPDATE media SET tag_values = '{"4":"draft memo"}' WHERE id IN (5, 7);
-- Pixel sizes as displayed (admin migration 0016), for the grid's layout:
-- - reaxxxxxxa is a portrait photo (60 × 80): its tile must be 3:4, not
--   cropped to the row;
-- - vrcxxxxxxa and vrcxxxxxxb are 16:9 (64 × 36);
-- - vrcxxxxxxc (also 64 × 36) and reaxxxxxxb have no size: their tiles
--   are 3:2 until the image loads, then take its own shape (vrcxxxxxxc
--   16:9; reaxxxxxxb's grey 1 × 1 stand-in square).
UPDATE media SET width = 60, height = 80 WHERE id = 1;
UPDATE media SET width = 64, height = 36 WHERE id IN (2, 4);
