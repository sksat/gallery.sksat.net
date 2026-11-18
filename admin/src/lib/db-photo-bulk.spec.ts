import { describe, expect, it } from "vitest";
import {
  listCameraChoices,
  listCameraPhotos,
  removeCameraFrom,
  restoreCameras,
  restorePlatforms,
  setCameras,
  setPlatforms,
  UnknownCameraError,
} from "./db-photo-bulk";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name, manufacturer, model) VALUES
      (1, 'b', 'Beta', 'm', 'b'), (2, 'a', 'alpha', 'm', 'a');
    INSERT INTO camera_image (camera_id, file, position) VALUES
      (1, '/camera/b/2.png', 1), (1, '/camera/b/1.png', 0);
    INSERT INTO media (id, file, platform, camera_id) VALUES
      (1, '/a.png', 'Real', 1),
      (2, '/b.png', 'Real', NULL),
      (3, '/c.png', 'Real', 2);
  `);
  const cameras = () =>
    raw
      .prepare("SELECT camera_id AS c FROM media ORDER BY id")
      .all()
      .map((r) => r.c);
  return { db: sqliteD1(raw), raw, cameras };
};

describe("setPlatforms / restorePlatforms", () => {
  it("sets the platform, returns what changed photos had, and undoes it", async () => {
    const { db, raw } = setup();
    raw.exec("UPDATE media SET platform = 'VRChat' WHERE id = 3");
    const platforms = () =>
      raw
        .prepare("SELECT platform AS p FROM media ORDER BY id")
        .all()
        .map((r) => r.p);
    const previous = await setPlatforms(db, [1, 2, 3], "VRChat");
    expect(platforms()).toEqual(["VRChat", "VRChat", "VRChat"]);
    expect(previous).toEqual([
      { id: 1, platform: "Real" },
      { id: 2, platform: "Real" },
    ]);
    await restorePlatforms(db, previous);
    expect(platforms()).toEqual(["Real", "Real", "VRChat"]);
  });
});

describe("the camera page", () => {
  it("lists a camera's photos, newest first, not the trash", async () => {
    const { db, raw } = setup();
    raw.exec(`
      UPDATE media SET camera_id = 1, timestamp = '2023-01-0' || id || 'T00:00:00Z';
      UPDATE media SET trashed_at = '2026-01-01T00:00:00Z' WHERE id = 2;
    `);
    expect((await listCameraPhotos(db, 1)).map((p) => p.id)).toEqual([3, 1]);
  });

  it("takes the camera off only the photos that have it", async () => {
    const { db, cameras } = setup();
    const previous = await removeCameraFrom(db, 1, [1, 3]);
    expect(previous).toEqual([{ id: 1, camera_id: 1 }]);
    expect(cameras()).toEqual([null, null, 2]);
    await restoreCameras(db, previous);
    expect(cameras()).toEqual([1, null, 2]);
  });
});

describe("listCameraChoices", () => {
  it("lists cameras by name with their first picture", async () => {
    const { db } = setup();
    expect(await listCameraChoices(db)).toEqual([
      { id: 2, name: "alpha", image: null },
      { id: 1, name: "Beta", image: "/camera/b/1.png" },
    ]);
  });
});

describe("setCameras / restoreCameras", () => {
  it("sets the camera, returns what changed photos had, and undoes it", async () => {
    const { db, cameras } = setup();
    const previous = await setCameras(db, [1, 2, 3], 2);
    expect(cameras()).toEqual([2, 2, 2]);
    // Photo 3 already had it: nothing to undo there.
    expect(previous).toEqual([
      { id: 1, camera_id: 1 },
      { id: 2, camera_id: null },
    ]);
    await restoreCameras(db, previous);
    expect(cameras()).toEqual([1, null, 2]);
  });

  it("clears the camera with null", async () => {
    const { db, cameras } = setup();
    expect(await setCameras(db, [1, 2], null)).toEqual([
      { id: 1, camera_id: 1 },
    ]);
    expect(cameras()).toEqual([null, null, 2]);
  });

  it("refuses a camera that does not exist", async () => {
    const { db, cameras } = setup();
    await expect(setCameras(db, [1], 99)).rejects.toBeInstanceOf(
      UnknownCameraError,
    );
    expect(cameras()).toEqual([1, null, 2]);
  });
});
