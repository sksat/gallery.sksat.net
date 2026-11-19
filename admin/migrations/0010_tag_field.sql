-- Fields of a tag: a tag (e.g. 「フィルム」) may define fields (フィルム銘柄,
-- ISO, 現像, ラボ…), and every photo that has the tag gets them on its
-- edit page. Values are per photo.
--
-- tag_field: one field of a tag, shown in `position` order.
--   label: its name (unique within the tag), what the admin and the public
--     site show. A field is addressed by its id, never by its label, so a
--     renamed label keeps its values; ids are never reused
--     (AUTOINCREMENT), so a value left by a removed field can never
--     attach to a new one.
--   type: text | number | date (YYYY-MM-DD) | select (one of `options`, a
--     JSON array of strings; NULL for the other types). The type is fixed
--     once created.
--   visibility: whether the public site shows the field ('shown') or not
--     ('hidden'); each photo may override it. The tag itself must be
--     public too, and the photo's tags level (metadata_visibility) must
--     let tags out.
-- media.tag_values: the photo's values, a JSON object of field id (as a
--   string) → value (a string, or a number for number fields). NULL when
--   it has none. One column, so the public list reads them with the row
--   (no join per photo).
-- media.tag_value_visibility: the photo's own levels for its fields, a
--   JSON object of field id → 'shown' | 'hidden'; a missing id follows
--   the field. Apart from metadata_visibility, which the edit page and the
--   bulk level sheet rewrite whole.
--
-- A removed field takes its values off the photos (the admin warns with
-- the count first, and its undo puts both back). Only tables and columns
-- are added.
CREATE TABLE tag_field (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id     INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  type       TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select')),
  options    TEXT CHECK (
               CASE WHEN type = 'select'
                 THEN options IS NOT NULL AND json_valid(options)
                      AND json_type(options) = 'array'
                      AND json_array_length(options) BETWEEN 1 AND 50
                 ELSE options IS NULL END),
  position   INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'shown'
             CHECK (visibility IN ('shown', 'hidden')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tag_id, label)
);
CREATE INDEX idx_tag_field_tag ON tag_field(tag_id, position);

ALTER TABLE media ADD COLUMN tag_values TEXT
  CHECK (tag_values IS NULL
         OR (json_valid(tag_values) AND json_type(tag_values) = 'object'));
ALTER TABLE media ADD COLUMN tag_value_visibility TEXT
  CHECK (tag_value_visibility IS NULL
         OR (json_valid(tag_value_visibility)
             AND json_type(tag_value_visibility) = 'object'));
