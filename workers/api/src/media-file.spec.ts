// The file the image Worker resizes for a photo (admin migration 0013,
// media_file), and what the queries read to find it, on the real schema.
import { describe, expect, it } from "vitest";
import {
  CAMERA_IMAGE_SQL,
  getPathAccess,
  getPhotoForImage,
  IMAGE_BY_ID_SQL,
  IMAGE_BY_PATH_SQL,
  LIST_SQL,
  listPublicMedia,
  MEDIA_BY_ID_SQL,
} from "./query";
import { d1, migratedDb } from "./sqlite-d1.test-helper";

const setup = () => {
  const raw = migratedDb();
  raw.exec(`
    INSERT INTO media (id, public_id, file, platform, visibility, metadata_visibility) VALUES
      (1, 'aaaaaaaaa2', '/a.png', 'Real', 'public', '{"file_name":"path"}'),
      (2, 'aaaaaaaaa3', '/b.png', 'Real', 'unlisted', NULL),
      (3, 'aaaaaaaaa4', '/c.png', 'Real', 'private', NULL);
    -- Photo 1: two retouched versions, the Lightroom one with display copies.
    INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status) VALUES
      (10, 1, 'edit', '/a_lightroom.jpg', 1, 'ready'),
      (11, 1, 'edit', '/a_ON1.png', 1, 'ready'),
      (12, 1, 'display', '/a_lightroom.d1.jpg', 10, 'ready'),
      (13, 1, 'display', '/a_lightroom.d2.jpg', 10, 'ready'),
      (14, 1, 'display', '/a_lightroom.d3.jpg', 10, 'uploading'),
      -- A copy of the original, and a private photo's edit.
      (15, 1, 'display', '/a.d.jpg', 1, 'ready'),
      (16, 3, 'edit', '/c_edit.jpg', 3, 'ready');
  `);
  return { raw, db: d1(raw) };
};

const sourceById = async (db: D1Database, id: string) =>
  (await getPhotoForImage(db, id))?.source;

describe("the pixel size (0016)", () => {
  it("is the original's, and unknown while an edit is shown", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET width = 3000, height = 4000 WHERE id = 1");
    expect((await listPublicMedia(db))[0]).toMatchObject({
      width: 3000,
      height: 4000,
    });
    // An edit may be cropped: the gallery takes the image's own shape.
    raw.exec("UPDATE media SET active_file_id = 10 WHERE id = 1");
    expect((await listPublicMedia(db))[0]).toMatchObject({
      width: null,
      height: null,
    });
  });
});

describe("the file to resize", () => {
  it("is the original, or its display copy, while the photo shows it", async () => {
    const { raw, db } = setup();
    // Photo 1's original has a ready display copy (15).
    expect(await sourceById(db, "aaaaaaaaa2")).toEqual({
      storage: "b2",
      key: "/a.d.jpg",
    });
    raw.exec("DELETE FROM media_file WHERE id = 15");
    expect(await sourceById(db, "aaaaaaaaa2")).toEqual({
      storage: "b2",
      key: "/a.png",
    });
    // Photo 2 has only its original; `file` stays the original's key.
    const b = await getPhotoForImage(db, "aaaaaaaaa3");
    expect(b?.file).toBe("/b.png");
    expect(b?.source).toEqual({ storage: "b2", key: "/b.png" });
  });

  it("follows the file each photo chooses, and its newest ready display copy", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET active_file_id = 10 WHERE id = 1");
    expect(await sourceById(db, "aaaaaaaaa2")).toEqual({
      storage: "b2",
      key: "/a_lightroom.d2.jpg",
    });
    raw.exec("UPDATE media SET active_file_id = 11 WHERE id = 1");
    expect(await sourceById(db, "aaaaaaaaa2")).toEqual({
      storage: "b2",
      key: "/a_ON1.png",
    });
    // The same by display path; `file` is still the original's key.
    const byPath = await getPathAccess(db, "/a.png");
    expect(byPath).toMatchObject({
      kind: "photo",
      photo: { file: "/a.png", source: { key: "/a_ON1.png" } },
    });
    raw.exec("UPDATE media_file SET storage = 'r2' WHERE id = 11");
    expect(await sourceById(db, "aaaaaaaaa2")).toEqual({
      storage: "r2",
      key: "/a_ON1.png",
    });
  });

  it("is never given for a private photo, and an edit's path is no camera picture", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET active_file_id = 16 WHERE id = 3");
    expect(await getPhotoForImage(db, "aaaaaaaaa4")).toBeNull();
    raw.exec(
      "INSERT INTO camera (id, slug, name) VALUES (1, 'x', 'X'); INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/c_edit.jpg', 0), (1, '/cam.jpg', 1)",
    );
    expect(await getPathAccess(db, "/c_edit.jpg")).toBeNull();
    expect(await getPathAccess(db, "/cam.jpg")).toEqual({
      kind: "camera-image",
      file: "/cam.jpg",
    });
  });

  it("leaves the public API's answers as they were", async () => {
    const { raw, db } = setup();
    const before = await listPublicMedia(db);
    raw.exec("UPDATE media SET active_file_id = 10 WHERE id = 1");
    expect(await listPublicMedia(db)).toEqual(before);
    expect(before[0]).not.toHaveProperty("source");
    expect(before[0].file).toBe("/a.png");
  });
});

describe("query plans", () => {
  const plan = (sql: string, ...args: string[]) => {
    const { raw } = setup();
    return (
      raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as {
        detail: string;
      }[]
    ).map((r) => r.detail);
  };

  it("the public list and photo never read media_file", () => {
    expect(plan(LIST_SQL).join("\n")).not.toMatch(/media_file/);
    expect(plan(MEDIA_BY_ID_SQL, "aaaaaaaaa2").join("\n")).not.toMatch(
      /media_file/,
    );
  });

  it("finds a photo's file in a few index steps", () => {
    for (const sql of [IMAGE_BY_ID_SQL, IMAGE_BY_PATH_SQL]) {
      const p = plan(sql, "aaaaaaaaa2");
      const text = p.join("\n");
      // No step scans a table.
      expect(text).not.toMatch(/\bSCAN\b/);
      expect(text).toMatch(
        /SEARCH o USING COVERING INDEX idx_media_file_\w+ \(media_id=\? AND role=\?\)/,
      );
      expect(text).toMatch(/SEARCH shown USING INTEGER PRIMARY KEY/);
      expect(text).toMatch(/SEARCH dc USING INDEX idx_media_file_source/);
      expect(text).toMatch(/SEARCH src USING INTEGER PRIMARY KEY/);
      expect(text).not.toMatch(/TEMP B-TREE/);
    }
    expect(plan(CAMERA_IMAGE_SQL, "/x.png").join("\n")).toMatch(
      /USING COVERING INDEX sqlite_autoindex_media_file_1/,
    );
  });
});
