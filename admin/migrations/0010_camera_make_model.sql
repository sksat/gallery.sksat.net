-- Uploads and the metadata reader link a photo to the camera row whose
-- manufacturer and model its file names (case aside, src/lib/device.ts),
-- and create one when there is none. This index answers that lookup
-- without reading every camera row (the expressions match deviceIdSql's
-- exactly). Only an index: the admin works the same before it is applied.
CREATE INDEX idx_camera_make_model ON camera(lower(manufacturer), lower(model));
