import { describe, expect, it } from "vitest";
import {
  addUploadedPicture,
  deleteCameraImageRow,
  getCameraImage,
  holdsPictureName,
  releasePictureName,
  RESERVATION_MS,
  reservePictureName,
  setCameraImageOrder,
  sharedCameraImages,
  takenPictureNames,
} from "./db-camera-image";
import {
  addCameraImage,
  addPhotoPictures,
  listCameraImages,
  listPickerPhotos,
  PathBusyError,
  PhotoFileError,
  PhotoNotPickableError,
  PICKER_PAGE,
  PICKER_PHOTOS_SQL,
  removeCameraImage,
  removePhotoPictures,
  restoreCameraImage,
} from "./db";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

// The camera pictures' queries on the real schema (node:sqlite).
const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A'), (2, 'b', 'B');
    INSERT INTO media (id, file, platform) VALUES (1, '/VRChat/photo.png', 'VRChat');
    INSERT INTO camera_image (id, camera_id, file, media_id, position) VALUES
      (10, 1, '/camera/a/front.png', NULL, 0),
      (11, 1, '/camera/a/back.png', NULL, 1),
      (12, 1, '/camera/a/side.png', NULL, 2),
      (13, 1, NULL, 1, 3),
      (20, 2, '/camera/a/back.png', NULL, 0),
      (21, 2, '/camera/a/front-1.png', NULL, 1);
  `);
  return { raw, db: sqliteD1(raw) };
};

const order = (raw: ReturnType<typeof setup>["raw"], cameraId: number) =>
  raw
    .prepare(
      "SELECT id FROM camera_image WHERE camera_id = ? ORDER BY position, id",
    )
    .all(cameraId)
    .map((r) => r.id);

const version = (raw: ReturnType<typeof setup>["raw"]) =>
  raw.prepare("SELECT value FROM setting WHERE key = 'content_version'").get()
    ?.value;

describe("setCameraImageOrder", () => {
  it("puts the pictures in the order, bumps the version, returns the old one", async () => {
    const { raw, db } = setup();
    expect(await setCameraImageOrder(db, 1, [12, 10, 11, 13])).toEqual({
      kind: "ok",
      previous: [10, 11, 12, 13],
    });
    expect(order(raw, 1)).toEqual([12, 10, 11, 13]);
    expect(version(raw)).toBeDefined();
    // The other camera is untouched.
    expect(order(raw, 2)).toEqual([20, 21]);
  });

  it("refuses an order of other pictures (changed meanwhile)", async () => {
    const { raw, db } = setup();
    expect(await setCameraImageOrder(db, 1, [12, 10, 11])).toEqual({
      kind: "stale",
    });
    expect(await setCameraImageOrder(db, 1, [10, 11, 12, 20])).toEqual({
      kind: "stale",
    });
    expect(order(raw, 1)).toEqual([10, 11, 12, 13]);
    expect(version(raw)).toBeUndefined();
  });
});

describe("setCameraImageOrder against a picture added meanwhile", () => {
  it("writes nothing and says stale", async () => {
    const { raw, db } = setup();
    // Another tab adds a picture between the read and the write.
    const racing = {
      ...db,
      prepare: db.prepare,
      batch: async (stmts: Parameters<D1Database["batch"]>[0]) => {
        raw.exec(
          "INSERT INTO camera_image (id, camera_id, file, position) VALUES (14, 1, '/camera/a/new.png', 4)",
        );
        return db.batch(stmts);
      },
    } as D1Database;
    expect(await setCameraImageOrder(racing, 1, [13, 10, 11, 12])).toEqual({
      kind: "stale",
    });
    expect(order(raw, 1)).toEqual([10, 11, 12, 13, 14]);
  });
});

describe("shared objects", () => {
  it("marks pictures whose object another camera uses", async () => {
    const { db } = setup();
    // 13 is a photo (0019): no object of its own.
    expect([...(await sharedCameraImages(db, 1))].sort()).toEqual([11]);
    expect(await getCameraImage(db, 1, 13)).toEqual({
      file: null,
      shared: false,
    });
    expect(await getCameraImage(db, 1, 10)).toEqual({
      file: "/camera/a/front.png",
      shared: false,
    });
    expect(await getCameraImage(db, 1, 11)).toEqual({
      file: "/camera/a/back.png",
      shared: true,
    });
    expect(await getCameraImage(db, 2, 10)).toBeNull();
  });
});

describe("takenPictureNames", () => {
  it("finds the name and its numbered names used by any picture or photo", async () => {
    const { db } = setup();
    const { candidates, taken } = await takenPictureNames(
      db,
      "/camera/a/front.png",
    );
    expect(candidates.slice(0, 3)).toEqual([
      "/camera/a/front.png",
      "/camera/a/front-1.png",
      "/camera/a/front-2.png",
    ]);
    expect([...taken].sort()).toEqual([
      "/camera/a/front-1.png",
      "/camera/a/front.png",
    ]);
    expect((await takenPictureNames(db, "/VRChat/photo.png")).taken).toContain(
      "/VRChat/photo.png",
    );
  });
});

describe("upload claims", () => {
  const file = "/camera/a/new.png";
  const t0 = new Date("2026-11-20T00:00:00.000Z");
  const shaA = "a".repeat(64);
  const shaB = "b".repeat(64);

  it("gives a name to one upload at a time, and again to the same bytes", async () => {
    const { db } = setup();
    expect(await reservePictureName(db, file, 1, shaA, t0)).toBe(true);
    // Another upload (other bytes, or another camera) at once: refused.
    expect(await reservePictureName(db, file, 1, shaB, t0)).toBe(false);
    expect(await reservePictureName(db, file, 2, shaA, t0)).toBe(false);
    // A retry of the same upload keeps it.
    expect(await reservePictureName(db, file, 1, shaA, t0)).toBe(true);
    expect(await holdsPictureName(db, file, 1, shaA)).toBe(true);
    expect(await holdsPictureName(db, file, 1, shaB)).toBe(false);
    expect(await holdsPictureName(db, file, 2, shaA)).toBe(false);
  });

  it("an upload's claim is refused on a path a picture or photo has", async () => {
    const { db } = setup();
    expect(
      await reservePictureName(db, "/camera/a/front.png", 1, shaA, t0, true),
    ).toBe(false);
    expect(
      await reservePictureName(db, "/VRChat/photo.png", 1, shaA, t0, true),
    ).toBe(false);
    expect(await reservePictureName(db, file, 1, shaA, t0, true)).toBe(true);
  });

  it("frees a claim once it expired", async () => {
    const { db } = setup();
    await reservePictureName(db, file, 1, shaA, t0);
    const later = new Date(t0.getTime() + RESERVATION_MS + 1);
    expect(await reservePictureName(db, file, 1, shaB, later)).toBe(true);
    expect(await holdsPictureName(db, file, 1, shaA)).toBe(false);
  });

  it("adds the uploaded picture at the end and drops its claim", async () => {
    const { raw, db } = setup();
    await reservePictureName(db, file, 1, shaA, t0);
    const id = await addUploadedPicture(db, 1, file);
    expect(id).toEqual(expect.any(Number));
    expect(order(raw, 1).at(-1)).toBe(id);
    expect(await holdsPictureName(db, file, 1, shaA)).toBe(false);
    expect(version(raw)).toBeDefined();
    // Again (a lost answer): nothing new.
    expect(await addUploadedPicture(db, 1, file)).toBeNull();
    expect(order(raw, 1)).toHaveLength(5);
  });
});

describe("deleteCameraImageRow", () => {
  it("deletes only this camera's row, with the content version", async () => {
    const { raw, db } = setup();
    const file = "/camera/a/front.png";
    expect(await deleteCameraImageRow(db, 2, 10, file, new Date())).toBe(false);
    expect(await deleteCameraImageRow(db, 1, 10, file, new Date())).toBe(true);
    expect(order(raw, 1)).toEqual([11, 12, 13]);
    expect(version(raw)).toBeDefined();
  });

  it("an undo of an earlier 外す cannot bring a deleted file back", async () => {
    const { raw, db } = setup();
    // Camera 2 had taken back.png off; camera 1 then deleted it.
    raw.exec("DELETE FROM camera_image WHERE id = 20");
    await deleteCameraImageRow(db, 1, 11, "/camera/a/back.png", new Date());
    await expect(
      restoreCameraImage(
        db,
        2,
        { file: "/camera/a/back.png", media_id: null, caption: null },
        0,
      ),
    ).rejects.toBeInstanceOf(PathBusyError);
    // Nothing moved.
    expect(order(raw, 2)).toEqual([21]);
    // Another picture's undo still works.
    await restoreCameraImage(
      db,
      2,
      { file: "/camera/a/other.png", media_id: null, caption: null },
      0,
    );
    expect(order(raw, 2)).toHaveLength(2);
  });

  it("a path held by a 削除 or an upload cannot be added meanwhile", async () => {
    const { db } = setup();
    const file = "/camera/a/front.png";
    // While held: refused, for any camera.
    expect(await reservePictureName(db, file, 1, "delete", new Date())).toBe(
      true,
    );
    await expect(
      addCameraImage(db, 2, { file, caption: null }),
    ).rejects.toBeInstanceOf(PathBusyError);
    // Released (the 削除 failed): allowed again.
    await releasePictureName(db, file);
    expect(
      (await addCameraImage(db, 2, { file: "/camera/a/x.png", caption: null }))
        .file,
    ).toBe("/camera/a/x.png");
    expect((await addCameraImage(db, 2, { file, caption: null })).file).toBe(
      file,
    );
  });
});

describe("photos as pictures (0019)", () => {
  /** setup() plus photos 2 (public), 3 (unlisted), 4 (private), 5 (trashed). */
  const photos = () => {
    const t = setup();
    t.raw.exec(`
      UPDATE media SET visibility = 'public' WHERE id = 1;
      INSERT INTO media (id, file, path, platform, visibility, trashed_at) VALUES
        (2, '/r/b.png', '/r/b.png', 'Real', 'public', NULL),
        (3, '/r/c.png', '/r/c.png', 'Real', 'unlisted', NULL),
        (4, '/r/d.png', '/r/d.png', 'Real', 'private', NULL),
        (5, '/r/e.png', '/r/e.png', 'Real', 'public', '2026-11-01T00:00:00Z');
      INSERT INTO media (id, file, path, platform, visibility, status) VALUES
        (6, '/r/f.png', '/r/f.png', 'Real', 'public', 'uploading');`);
    return t;
  };

  it("adds public and unlisted photos at the end, with the content version", async () => {
    const { raw, db } = photos();
    // 1 is a picture of camera 1 already; 4-6 cannot be pictures.
    const added = await addPhotoPictures(db, 1, [3, 4, 1, 5, 6, 2]);
    expect(added).toHaveLength(2);
    expect(
      raw
        .prepare(
          "SELECT media_id FROM camera_image WHERE camera_id = 1 ORDER BY position, id",
        )
        .all()
        .map((r) => r.media_id),
    ).toEqual([null, null, null, 1, 3, 2]);
    expect(version(raw)).toBeDefined();
    // Undo: those pictures only.
    await removePhotoPictures(db, 1, added);
    expect(order(raw, 1)).toEqual([10, 11, 12, 13]);
  });

  it("lists a photo's picture with its photo", async () => {
    const { raw, db } = photos();
    raw.exec("UPDATE media SET path = '/moved/photo.png' WHERE id = 1");
    const images = await listCameraImages(db, 1);
    expect(images.at(-1)).toMatchObject({
      id: 13,
      file: null,
      media_id: 1,
      photo: {
        file: "/VRChat/photo.png",
        path: "/moved/photo.png",
        visibility: "public",
        live: true,
      },
    });
    expect(images[0].photo).toBeNull();
  });

  it("puts a removed photo back only while it may be a picture", async () => {
    const { raw, db } = photos();
    const [id] = await addPhotoPictures(db, 2, [2]);
    const removed = await removeCameraImage(db, 2, id);
    expect(removed).toEqual({
      file: null,
      media_id: 2,
      caption: null,
      index: 2,
    });
    raw.exec("UPDATE media SET visibility = 'private' WHERE id = 2");
    await expect(
      restoreCameraImage(db, 2, removed!, removed!.index),
    ).rejects.toBeInstanceOf(PhotoNotPickableError);
    expect(order(raw, 2)).toEqual([20, 21]);
    raw.exec("UPDATE media SET visibility = 'unlisted' WHERE id = 2");
    await restoreCameraImage(db, 2, removed!, 0);
    expect(
      raw
        .prepare(
          "SELECT media_id FROM camera_image WHERE camera_id = 2 ORDER BY position, id",
        )
        .all()
        .map((r) => r.media_id),
    ).toEqual([2, null, null]);
  });

  it("refuses a photo's file as a picture's own file", async () => {
    const { db } = photos();
    await expect(
      addCameraImage(db, 2, { file: "/r/d.png", caption: null }),
    ).rejects.toBeInstanceOf(PhotoFileError);
  });
});

describe("listPickerPhotos", () => {
  const library = () => {
    const raw = migratedSqlite();
    const insert = raw.prepare(
      "INSERT INTO media (file, platform, visibility) VALUES (?, 'Real', 'public')",
    );
    for (let i = 0; i < PICKER_PAGE + 5; i++) {
      insert.run(`/a/${String(i).padStart(3, "0")}.png`);
    }
    insert.run("/b/x.png");
    insert.run("/a-other/y.png");
    raw.exec(`INSERT INTO media (file, platform, status) VALUES ('/a/zz.png', 'Real', 'uploading');
      UPDATE media SET trashed_at = '2026-11-01T00:00:00Z' WHERE file = '/a/000.png';`);
    return { raw, db: sqliteD1(raw) };
  };

  it("pages through a folder by path, live photos only", async () => {
    const { db } = library();
    const first = await listPickerPhotos(db, "/a", "");
    expect(first.photos).toHaveLength(PICKER_PAGE);
    expect(first.photos[0].path).toBe("/a/001.png");
    expect(first.more).toBe(true);
    const next = await listPickerPhotos(db, "/a/", first.photos.at(-1)!.path);
    expect(next.photos.map((p) => p.path)).toEqual([
      "/a/041.png",
      "/a/042.png",
      "/a/043.png",
      "/a/044.png",
    ]);
    expect(next.more).toBe(false);
    expect((await listPickerPhotos(db, "/", "")).photos[0].path).toBe(
      "/a-other/y.png",
    );
  });

  it("reads a range of the path index", () => {
    const { raw } = library();
    const plan = (
      raw
        .prepare(`EXPLAIN QUERY PLAN ${PICKER_PHOTOS_SQL}`)
        .all("/a/", "/a0", "", 41) as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(/SEARCH media USING INDEX idx_media_path_live/);
    expect(plan).not.toMatch(/SCAN|TEMP B-TREE/);
  });
});
