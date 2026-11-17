-- Deterministic E2E + VRT fixture (5 media rows, 2 cameras). Mirrors the
-- public test-media set (public/test-media/{media,cameras}.json).
DELETE FROM media;
DELETE FROM cameras;
DELETE FROM sqlite_sequence WHERE name IN ('media', 'cameras');
INSERT INTO cameras (id, slug, name, make, model, kind, description, url, updated_at) VALUES
  (1, 'virtuallens2', 'VirtualLens2', 'logilabo', 'VirtualLens2', 'virtual', 'Virtual camera for VRChat.', 'https://example.com/virtuallens2', '2024-01-01T00:00:00.000Z'),
  (2, 'pentax-sp',    'PENTAX SP',    'Asahi',    'Pentax SP',    'film',    NULL,                         NULL,                               '2024-01-01T00:00:00.000Z');
INSERT INTO media (id, file, world, timestamp, camera_id, tags, updated_at) VALUES
  (1, '/mock/real1.png',   'Real',   '2023-12-01T00:00:00Z', NULL, '[]',         '2024-01-01T00:00:00.000Z'),
  (2, '/mock/vrchat1.png', 'VRChat', '2023-12-02T00:00:00Z', 1,    '["VRChat"]', '2024-01-01T00:00:00.000Z'),
  (3, '/mock/real2.png',   'Real',   '2023-12-03T00:00:00Z', NULL, '[]',         '2024-01-01T00:00:00.000Z'),
  (4, '/mock/vrchat2.png', 'VRChat', '2023-12-04T00:00:00Z', NULL, '["VRChat"]', '2024-01-01T00:00:00.000Z'),
  (5, '/mock/vrchat3.png', 'VRChat', '2023-12-05T00:00:00Z', NULL, '["VRChat"]', '2024-01-01T00:00:00.000Z');
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('media', 5), ('cameras', 2);
