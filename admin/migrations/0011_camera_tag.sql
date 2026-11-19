-- Tags of a camera. A camera may carry tags (e.g. a film camera:
-- 「フィルム」), each of which can also go to every photo taken with it.
--
-- camera_tag: one tag of a camera, by the tag's name (as media.tags holds
--   names; tags are never renamed), in `position` order.
--   propagate: 1 = every photo whose camera this is has the tag too
--     (「写真にも付ける」), 0 = the camera's own only.
--
-- A photo's tags are its own (media.tags) and the propagated tags of its
-- camera. They are worked out when read, never copied into media.tags:
-- changing a camera's tags, or a photo's camera, changes every photo at
-- once with nothing to backfill. Such a tag is public only when the tag
-- itself is (the `tag` table), like any other; its fields (0010) apply,
-- with the values kept per photo.
CREATE TABLE camera_tag (
  camera_id  INTEGER NOT NULL REFERENCES camera(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 200),
  propagate  INTEGER NOT NULL DEFAULT 1 CHECK (propagate IN (0, 1)),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (camera_id, tag)
) WITHOUT ROWID;
