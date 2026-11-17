-- Deterministic fixture for the gallery's E2E and VRT, loaded into the
-- local D1 behind the API Worker (e2e/start-api-server.sh). Mirrors
-- public/test-media (see the README there): five public photos with fixed
-- public ids, plus one unlisted and one private photo that must never show
-- up in lists.
INSERT INTO camera (id, slug, name, manufacturer, manufacturer_url, model, kind, description, product_url) VALUES
  (1, 'pentax-sp',    'PENTAX SP',    'Asahi',    NULL,                           'Pentax SP',    'film',    NULL, NULL),
  (2, 'virtuallens2', 'VirtualLens2', 'logilabo', 'https://example.com/logilabo', 'VirtualLens2', 'virtual', 'Virtual camera for VRChat.' || char(10) || 'Second line of the description.', 'https://example.com/virtuallens2');
INSERT INTO camera_image (camera_id, file, position, caption) VALUES
  (2, '/camera/virtuallens2/front.png', 0, 'Front'),
  (2, '/camera/virtuallens2/ui.png',    1, NULL),
  (2, '/camera/virtuallens2/side.png',  2, 'Side');
INSERT INTO media (id, public_id, file, world, timestamp, camera_id, tags, visibility, legacy_index) VALUES
  (1, 'reaxxxxxxa', '/mock/real1.png',    'Real',   '2023-12-01T00:00:00Z', 1,    '["film"]',           'public',   0),
  (2, 'vrcxxxxxxa', '/mock/vrchat1.png',  'VRChat', '2023-12-02T00:00:00Z', 2,    '["VRChat"]',         'public',   1),
  (3, 'reaxxxxxxb', '/mock/real2.png',    'Real',   '2023-12-03T00:00:00Z', NULL, '["night"]',          'public',   2),
  (4, 'vrcxxxxxxb', '/mock/vrchat2.png',  'VRChat', '2023-12-04T00:00:00Z', NULL, '["VRChat","night"]', 'public',   3),
  (5, 'vrcxxxxxxc', '/mock/vrchat3.png',  'VRChat', '2023-12-05T00:00:00Z', 2,    '["VRChat"]',         'public',   4),
  (6, 'unxxxxxxxx', '/mock/unlisted.png', 'VRChat', '2023-12-06T00:00:00Z', 2,    '["VRChat","night"]', 'unlisted', 5),
  (7, 'pvxxxxxxxx', '/mock/private.png',  'Real',   '2023-12-07T00:00:00Z', NULL, '["secret"]',         'private',  6);
