-- Deterministic E2E + VRT fixture (5 media rows, 2 cameras, 2 camera
-- images). Mirrors the public test-media set
-- (public/test-media/{media,cameras}.json).
DELETE FROM media;
DELETE FROM camera_image;
DELETE FROM camera;
DELETE FROM folder;
DELETE FROM sqlite_sequence WHERE name IN ('media', 'camera', 'camera_image', 'folder');
INSERT INTO camera (id, slug, name, manufacturer, manufacturer_url, model, kind, description, product_url, updated_at) VALUES
  (1, 'virtuallens2', 'VirtualLens2', 'logilabo', 'https://example.com/logilabo', 'VirtualLens2', 'virtual', 'Virtual camera for VRChat.', 'https://example.com/virtuallens2', '2024-01-01T00:00:00.000Z'),
  (2, 'pentax-sp',    'PENTAX SP',    'Asahi',    NULL,                           'Pentax SP',    'film',    NULL,                         NULL,                               '2024-01-01T00:00:00.000Z');
-- Visibility: rows 1-3 public, 4 unlisted, 5 private. public_id is fixed
-- (the trigger would pick a random one).
INSERT INTO media (id, public_id, file, platform, timestamp, camera_id, tags, visibility, updated_at) VALUES
  (1, 'aaaaaaaaa2', '/mock/real1.png',   'Real',   '2023-12-01T00:00:00Z', NULL, '[]',         'public',   '2024-01-01T00:00:00.000Z'),
  (2, 'aaaaaaaaa3', '/mock/vrchat1.png', 'VRChat', '2023-12-02T00:00:00Z', 1,    '["VRChat"]', 'public',   '2024-01-01T00:00:00.000Z'),
  (3, 'aaaaaaaaa4', '/mock/real2.png',   'Real',   '2023-12-03T00:00:00Z', NULL, '[]',         'public',   '2024-01-01T00:00:00.000Z'),
  (4, 'aaaaaaaaa5', '/mock/vrchat2.png', 'VRChat', '2023-12-04T00:00:00Z', NULL, '["VRChat"]', 'unlisted', '2024-01-01T00:00:00.000Z'),
  (5, 'aaaaaaaaa6', '/mock/vrchat3.png', 'VRChat', '2023-12-05T00:00:00Z', NULL, '["VRChat"]', 'private',  '2024-01-01T00:00:00.000Z');
-- Tags: VRChat is public, "draft" (on no photo yet) private.
INSERT INTO tag (name, public) VALUES ('VRChat', 1), ('draft', 0);
INSERT INTO camera_image (id, camera_id, file, position, caption) VALUES
  (1, 1, '/camera/virtuallens2/front.png', 0, 'Front'),
  (2, 1, '/camera/virtuallens2/ui.png',    1, NULL);
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('media', 5), ('camera', 2), ('camera_image', 2);
-- Sizes for the dashboard's 容量 card: 30.0 MB in all; public 12.0 MB,
-- unlisted 12.0 MB, private 6.00 MB.
UPDATE media SET size = 2500000  WHERE id = 1;
UPDATE media SET size = 8000000  WHERE id = 2;
UPDATE media SET size = 1500000  WHERE id = 3;
UPDATE media SET size = 12000000 WHERE id = 4;
UPDATE media SET size = 6000000  WHERE id = 5;
-- Positions (the map): photo 1 (public) at Tokyo Station, photo 5
-- (private) in Osaka; the others have none.
UPDATE media SET latitude = 35.681236, longitude = 139.767125, location_source = 'exif' WHERE id = 1;
UPDATE media SET latitude = 34.702485, longitude = 135.495951, location_source = 'manual' WHERE id = 5;
