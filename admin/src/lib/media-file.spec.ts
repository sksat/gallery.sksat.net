import { describe, expect, it } from "vitest";
import {
  IMAGE_SOURCE_SQL,
  imageSource,
  PHOTO_OBJECTS_SQL,
  photoObjects,
} from "./media-file";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform, public_id) VALUES
      (1, '/a.png', 'Real', '2345678923'), (2, '/b.png', 'Real', '3456789234');
    INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status) VALUES
      (10, 1, 'edit', '/a_lightroom.jpg', 1, 'ready'),
      (11, 1, 'display', '/a_lightroom.d.jpg', 10, 'ready'),
      (12, 1, 'display', '/a_lightroom.d2.jpg', 10, 'failed');
    INSERT INTO camera (id, slug, name) VALUES (1, 'c', 'C');
    -- A picture of its own, and photo 1 chosen as a picture (0019).
    INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/camera/c/x.png', 0);
    INSERT INTO camera_image (camera_id, media_id, position) VALUES (1, 1, 1);
  `);
  return { raw, db: sqliteD1(raw) };
};

describe("imageSource", () => {
  it("is the original until the photo shows another file, then that file's display copy", async () => {
    const { raw, db } = setup();
    const publicId = "2345678923";
    expect(await imageSource(db, "/a.png")).toEqual({
      storage: "b2",
      key: "/a.png",
      publicId,
    });
    raw.exec("UPDATE media SET active_file_id = 10 WHERE id = 1");
    expect(await imageSource(db, "/a.png")).toEqual({
      storage: "b2",
      key: "/a_lightroom.d.jpg",
      publicId,
    });
    raw.exec("DELETE FROM media_file WHERE id = 11");
    expect(await imageSource(db, "/a.png")).toEqual({
      storage: "b2",
      key: "/a_lightroom.jpg",
      publicId,
    });
    // Not a photo's original (a camera picture): itself.
    expect(await imageSource(db, "/camera/c/front.png")).toEqual({
      storage: "b2",
      key: "/camera/c/front.png",
      publicId: null,
    });
  });

  it("reads a few index entries", () => {
    const { raw } = setup();
    const plan = (
      raw.prepare(`EXPLAIN QUERY PLAN ${IMAGE_SOURCE_SQL}`).all("/a.png") as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/\bSCAN\b|TEMP B-TREE/);
    expect(plan).toMatch(/SEARCH m USING INDEX sqlite_autoindex_media_1/);
    expect(plan).toMatch(/SEARCH dc USING INDEX idx_media_file_source/);
  });
});

describe("photoObjects", () => {
  it("lists every file of the photos (none a camera picture's own, 0019)", async () => {
    const { db } = setup();
    expect(await photoObjects(db, [1])).toEqual([
      { mediaId: 1, storage: "b2", key: "/a.png", shared: false },
      { mediaId: 1, storage: "b2", key: "/a_lightroom.jpg", shared: false },
      { mediaId: 1, storage: "b2", key: "/a_lightroom.d.jpg", shared: false },
      { mediaId: 1, storage: "b2", key: "/a_lightroom.d2.jpg", shared: false },
    ]);
    expect(await photoObjects(db, [])).toEqual([]);
  });

  it("finds them by photo", () => {
    const { raw } = setup();
    const plan = (
      raw.prepare(`EXPLAIN QUERY PLAN ${PHOTO_OBJECTS_SQL}`).all("[1]") as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(
      /SEARCH f USING INDEX idx_media_file_(media|original)/,
    );
    expect(plan).not.toMatch(/SCAN f\b/);
  });
});
