-- Deterministic E2E + VRT fixture (5 rows). Mirrors the public test-media set.
DELETE FROM media;
DELETE FROM sqlite_sequence WHERE name = 'media';
INSERT INTO media (id, file, world, timestamp, camera_make, camera_model, tags, updated_at) VALUES
  (1, '/mock/real1.png',   'Real',   '2023-12-01T00:00:00Z', NULL,        NULL,            '[]',                          '2024-01-01T00:00:00.000Z'),
  (2, '/mock/vrchat1.png', 'VRChat', '2023-12-02T00:00:00Z', 'logilabo',  'VirtualLens2',  '["VRChat"]',                  '2024-01-01T00:00:00.000Z'),
  (3, '/mock/real2.png',   'Real',   '2023-12-03T00:00:00Z', NULL,        NULL,            '[]',                          '2024-01-01T00:00:00.000Z'),
  (4, '/mock/vrchat2.png', 'VRChat', '2023-12-04T00:00:00Z', NULL,        NULL,            '["VRChat"]',                  '2024-01-01T00:00:00.000Z'),
  (5, '/mock/vrchat3.png', 'VRChat', '2023-12-05T00:00:00Z', NULL,        NULL,            '["VRChat"]',                  '2024-01-01T00:00:00.000Z');
INSERT INTO sqlite_sequence (name, seq) VALUES ('media', 5);
