-- Whether a tag is public is chosen per photo and per tag (0020 is taken
-- by another change). Until now a tag was public on the public site when
-- the tag itself was (the `tag` table's public flag) and the photo's
-- metadata level `tags` (metadata_visibility, or the site's default) was
-- 'public'; that level hid all of a photo's tags or none.
--
-- media.tag_visibility: the tags this photo hides, a JSON object of tag
--   name → 'hidden'. A public tag (the `tag` table) is shown on every
--   photo that does not hide it; a private tag is never shown, on any
--   photo, so making a tag private hides it everywhere and making it
--   public again shows it on the photos that do not hide it. Its own tags
--   and those its camera passes on (0011) alike. Any other value is no
--   choice ('shown' too), or hidden when it is not a choice at all (the
--   API Worker reads it failing closed). NULL when it hides none. One
--   column, so the public list reads it with the row (no join per photo).
--
-- The `tags` level goes away. A photo whose tags were hidden by it (its
-- own level, or the site's default when it had none; any value other
-- than 'public' hid them, as the API Worker read it) gets 'hidden' for
-- every tag it has now, its camera's included, public or not, so nothing
-- hidden today is shown after this, also when a tag is made public later.
ALTER TABLE media ADD COLUMN tag_visibility TEXT
  CHECK (tag_visibility IS NULL
         OR (json_valid(tag_visibility)
             AND json_type(tag_visibility) = 'object'));

UPDATE media SET tag_visibility = (
  SELECT NULLIF(json_group_object(t.name, 'hidden'), '{}')
  FROM (
    SELECT j.value AS name
    FROM json_each(CASE WHEN json_valid(media.tags)
                          AND json_type(media.tags) = 'array'
                        THEN media.tags ELSE '[]' END) j
    WHERE j.type = 'text'
    UNION
    SELECT ct.tag FROM camera_tag ct
    WHERE ct.camera_id = media.camera_id AND ct.propagate = 1
  ) t
)
-- The level as the API Worker worked it out (metadata.ts effectiveLevels):
-- the photo's, else the site's (a JSON null is none), else 'public'.
WHERE COALESCE(
  CASE WHEN json_type(metadata_visibility, '$.tags') <> 'null'
    THEN json_extract(metadata_visibility, '$.tags') END,
  (SELECT CASE WHEN json_type(s.value, '$.tags') <> 'null'
            THEN json_extract(s.value, '$.tags') END
   FROM setting s WHERE s.key = 'metadata_visibility'),
  'public'
) IS NOT 'public';

-- The level itself, from the photos and from the site's defaults.
UPDATE media
SET metadata_visibility = NULLIF(json_remove(metadata_visibility, '$.tags'), '{}')
WHERE json_type(metadata_visibility, '$.tags') IS NOT NULL;

UPDATE setting SET value = json_remove(value, '$.tags'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'metadata_visibility' AND json_type(value, '$.tags') IS NOT NULL;

-- And from the upload rules (setting 'upload_rules', a JSON array of
-- rules whose actions.metadata may name it), in their order.
UPDATE setting SET value = (
  SELECT json_group_array(json(r.rule)) FROM (
    SELECT CASE WHEN json_type(j.value, '$.actions.metadata.tags') IS NOT NULL
             THEN json_remove(j.value, '$.actions.metadata.tags')
             ELSE j.value END AS rule
    FROM json_each(setting.value) j ORDER BY j.key
  ) r
),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'upload_rules' AND json_type(value) = 'array'
  AND EXISTS (SELECT 1 FROM json_each(setting.value) j
              WHERE json_type(j.value, '$.actions.metadata.tags') IS NOT NULL);
