-- Deterministic E2E + VRT fixture (5 media rows, 2 cameras, 2 camera
-- images). Mirrors the public test-media set
-- (public/test-media/{media,cameras}.json).
DELETE FROM media;
DELETE FROM camera_image;
DELETE FROM camera;
DELETE FROM sqlite_sequence WHERE name IN ('media', 'camera', 'camera_image');
INSERT INTO camera (id, slug, name, manufacturer, manufacturer_url, model, kind, description, product_url, updated_at) VALUES
  (1, 'virtuallens2', 'VirtualLens2', 'logilabo', 'https://example.com/logilabo', 'VirtualLens2', 'virtual', 'Virtual camera for VRChat.', 'https://example.com/virtuallens2', '2024-01-01T00:00:00.000Z'),
  (2, 'pentax-sp',    'PENTAX SP',    'Asahi',    NULL,                           'Pentax SP',    'film',    NULL,                         NULL,                               '2024-01-01T00:00:00.000Z');
INSERT INTO media (id, file, world, timestamp, camera_id, tags, updated_at) VALUES
  (1, '/mock/real1.png',   'Real',   '2023-12-01T00:00:00Z', NULL, '[]',         '2024-01-01T00:00:00.000Z'),
  (2, '/mock/vrchat1.png', 'VRChat', '2023-12-02T00:00:00Z', 1,    '["VRChat"]', '2024-01-01T00:00:00.000Z'),
  (3, '/mock/real2.png',   'Real',   '2023-12-03T00:00:00Z', NULL, '[]',         '2024-01-01T00:00:00.000Z'),
  (4, '/mock/vrchat2.png', 'VRChat', '2023-12-04T00:00:00Z', NULL, '["VRChat"]', '2024-01-01T00:00:00.000Z'),
  (5, '/mock/vrchat3.png', 'VRChat', '2023-12-05T00:00:00Z', NULL, '["VRChat"]', '2024-01-01T00:00:00.000Z');
INSERT INTO camera_image (id, camera_id, file, position, caption) VALUES
  (1, 1, '/cameras/virtuallens2-front.png', 0, 'Front'),
  (2, 1, '/cameras/virtuallens2-ui.png',    1, NULL);
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('media', 5), ('camera', 2), ('camera_image', 2);
