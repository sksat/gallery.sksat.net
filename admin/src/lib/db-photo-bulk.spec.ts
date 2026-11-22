import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backfillBatch,
  PHOTO_META_PARSER_DATE,
  type ReadBytes,
} from "./backfill";
import {
  listCameraChoices,
  listCameraPhotos,
  removeCameraFrom,
  restoreCameras,
  restoreInfo,
  restorePlatforms,
  setCameras,
  setInfo,
  setPlatforms,
  UnknownCameraError,
} from "./db-photo-bulk";
import { KEEP, validateInfoRestore, type InfoUndoRow } from "./bulk-info";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("setInfo / restoreInfo", () => {
  it("edits the touched columns, creates new tags private, and undoes per photo", async () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO media (id, file, platform, tags, timestamp, exif) VALUES
        (1, '/a.png', 'Real', '["night"]', '2023-01-01T00:00:00Z', NULL),
        (2, '/b.png', 'Real', '["roll1"]', NULL, '{"iso":100}');
      INSERT INTO tag (name, public) VALUES ('night', 1);
    `);
    const db = sqliteD1(raw);
    const read = () =>
      raw
        .prepare(
          "SELECT id, tags, timestamp, exif, metadata_visibility AS mv FROM media ORDER BY id",
        )
        .all();
    const before = read();
    const { previous, newTags } = await setInfo(db, [1, 2], {
      tagsAdd: ["roll1"],
      takenAt: { date: "1999-08-01", time: null, offset: "keep" },
      exif: { lens: "50mm" },
    });
    expect(newTags).toEqual(["roll1"]);
    expect(
      raw.prepare("SELECT public FROM tag WHERE name = 'roll1'").get(),
    ).toEqual({ public: 0 });
    expect(read()).toEqual([
      {
        id: 1,
        tags: '["night","roll1"]',
        timestamp: "1999-08-01T00:00:00Z",
        exif: '{"lens":"50mm"}',
        mv: '{"taken_at":"date"}',
      },
      {
        id: 2,
        tags: '["roll1"]',
        timestamp: "1999-08-01T00:00:00+09:00",
        exif: '{"lens":"50mm","iso":100}',
        mv: '{"taken_at":"date"}',
      },
    ]);
    expect(previous.map((p) => p.id)).toEqual([1, 2]);
    // Through the undo's own check, as the action takes it.
    const back = validateInfoRestore(JSON.parse(JSON.stringify(previous)), 100);
    if (!back.ok) throw new Error(back.error);
    await restoreInfo(db, back.rows);
    expect(read()).toEqual(before);
  });

  it("makes tags public or not per photo (0021), and undoes it", async () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A');
      INSERT INTO camera_tag (camera_id, tag, propagate) VALUES (1, 'VRChat', 1);
      INSERT INTO media (id, file, platform, tags, camera_id, tag_visibility) VALUES
        (1, '/a.png', 'Real', '["film","secret"]', NULL, NULL),
        (2, '/b.png', 'Real', '["film","VRChat"]', 1, '{"VRChat":"hidden","film":"hidden"}'),
        (3, '/c.png', 'Real', '[]', NULL, NULL);
      INSERT INTO tag (name, public) VALUES ('film', 1), ('secret', 0), ('VRChat', 1);
    `);
    const db = sqliteD1(raw);
    const read = () =>
      raw
        .prepare("SELECT id, tags, tag_visibility AS tv FROM media ORDER BY id")
        .all();
    const before = read();
    const { previous } = await setInfo(db, [1, 2, 3], {
      tagsRemove: ["VRChat"],
      tagVisibility: { film: true, secret: true },
    });
    expect(read()).toEqual([
      { id: 1, tags: '["film","secret"]', tv: '{"secret":"shown"}' },
      // VRChat still comes from the camera: its choice stays.
      { id: 2, tags: '["film"]', tv: '{"VRChat":"hidden"}' },
      { id: 3, tags: "[]", tv: null },
    ]);
    expect(previous.map((p) => p.id)).toEqual([1, 2]);
    const back = validateInfoRestore(JSON.parse(JSON.stringify(previous)), 100);
    if (!back.ok) throw new Error(back.error);
    await restoreInfo(db, back.rows);
    expect(read()).toEqual(before);

    // A tag hidden after the edit stays hidden through its undo.
    const again = await setInfo(db, [1], { tagVisibility: { secret: true } });
    raw.exec(
      `UPDATE media SET tag_visibility = '{"film":"hidden","secret":"hidden"}' WHERE id = 1`,
    );
    const undo = validateInfoRestore(
      JSON.parse(JSON.stringify(again.previous)),
      100,
    );
    if (!undo.ok) throw new Error(undo.error);
    await restoreInfo(db, undo.rows);
    expect(read()[0]).toEqual({
      id: 1,
      tags: '["film","secret"]',
      tv: '{"film":"hidden","secret":"hidden"}',
    });
  });

  it("marks what it changes manual, and the undo puts the sources back exactly", async () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO media (id, file, platform, timestamp, exif, metadata_source) VALUES
        (1, '/a.png', 'Real', '2023-01-01T00:00:00Z', '{"iso":100}',
         '{"taken_at":"exif","exif":"file","digitized_with":"manual"}'),
        (2, '/b.png', 'Real', NULL, NULL, NULL),
        (3, '/c.png', 'Real', NULL, '{"iso":100}', '{"exif":"file"}');
    `);
    const db = sqliteD1(raw);
    const sources = () =>
      raw
        .prepare("SELECT metadata_source AS s FROM media ORDER BY id")
        .all()
        .map((r) => r.s);
    const before = sources();
    const { previous } = await setInfo(db, [1, 2, 3], {
      takenAt: { date: "1999-08-01", time: "10:00", offset: "keep" },
      exif: { iso: 100 },
    });
    expect(sources().map((s) => JSON.parse(String(s)))).toEqual([
      // iso was already 100 on 1 and 3: only the time taken changed there.
      { taken_at: "manual", exif: "file", digitized_with: "manual" },
      { taken_at: "manual", exif: "manual" },
      { exif: "file", taken_at: "manual" },
    ]);
    const back = validateInfoRestore(JSON.parse(JSON.stringify(previous)), 100);
    if (!back.ok) throw new Error(back.error);
    await restoreInfo(db, back.rows);
    expect(sources()).toEqual(before);
  });

  it("the undo leaves a source marked since by another edit", async () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO media (id, file, platform, timestamp, latitude, longitude,
                         location_source, metadata_source) VALUES
        (1, '/a.png', 'Real', '2023-01-01T00:00:00Z', 35, 139, 'exif',
         '{"taken_at":"exif"}');
    `);
    const db = sqliteD1(raw);
    const { previous } = await setInfo(db, [1], {
      takenAt: { date: "1999-08-01", time: KEEP, offset: KEEP },
      location: null,
    });
    const now = () =>
      raw
        .prepare(
          "SELECT latitude, location_source, metadata_source AS s FROM media",
        )
        .get();
    expect(now()).toEqual({
      latitude: null,
      location_source: "manual",
      s: '{"taken_at":"manual"}',
    });
    // The edit page chooses a スキャン機材 meanwhile.
    raw.exec(
      `UPDATE media SET metadata_source = json_set(metadata_source, '$.digitized_with', 'manual')`,
    );
    const back = validateInfoRestore(JSON.parse(JSON.stringify(previous)), 100);
    if (!back.ok) throw new Error(back.error);
    await restoreInfo(db, back.rows);
    expect(now()).toEqual({
      latitude: 35,
      location_source: "exif",
      s: '{"taken_at":"exif","digitized_with":"manual"}',
    });
  });

  it("leaves what it set to the metadata reader's later reading alone", async () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO media (id, file, platform, timestamp) VALUES
        (1, '/a/exif.jpg', 'Real', NULL),
        (2, '/a/world.png', 'VRChat', NULL);
    `);
    const db = sqliteD1(raw);
    const files: Record<string, Uint8Array> = {
      "/a/exif.jpg": fixture("exif-gps.jpg"),
      "/a/world.png": fixture("vrchat-xmp.png"),
    };
    const read: ReadBytes = async (file, range) => {
      const all = files[file];
      if (!all) return null;
      const bytes =
        "suffix" in range
          ? all.subarray(Math.max(0, all.length - range.suffix))
          : all.subarray(range.offset, range.offset + range.length);
      return { bytes, size: all.length };
    };
    await setInfo(db, [1, 2], {
      takenAt: { date: "1999-08-01", time: "10:00", offset: "+09:00" },
      exif: { lens: "hand" },
      world: { id: "wrld_00000000-0000-0000-0000-000000000000", name: "Hand" },
    });
    const columns = () =>
      raw
        .prepare(
          "SELECT timestamp, exif, world_id, world_name FROM media ORDER BY id",
        )
        .all();
    const set = columns();
    const now = Date.parse(PHOTO_META_PARSER_DATE) + 24 * 3600 * 1000;
    const r = await backfillBatch(db, read, 10, now);
    expect(r.read).toBe(2);
    expect(r.failed).toBe(0);
    expect(columns()).toEqual(set);
  });
});

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
    expect(previous).toEqual([{ id: 1, camera_id: 1, camera_source: null }]);
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
      { id: 1, camera_id: 1, camera_source: null },
      { id: 2, camera_id: null, camera_source: null },
    ]);
    await restoreCameras(db, previous);
    expect(cameras()).toEqual([1, null, 2]);
  });

  it("clears the camera with null", async () => {
    const { db, cameras } = setup();
    expect(await setCameras(db, [1, 2], null)).toEqual([
      { id: 1, camera_id: 1, camera_source: null },
    ]);
    expect(cameras()).toEqual([null, null, 2]);
  });

  it("marks the camera chosen by hand, and the undo puts the source back", async () => {
    const { db, raw } = setup();
    raw.exec(`UPDATE media SET metadata_source = CASE id
      WHEN 1 THEN '{"taken_at":"exif","camera":"file"}'
      WHEN 3 THEN '{"camera":"file"}' END`);
    const sources = () =>
      raw
        .prepare("SELECT metadata_source AS s FROM media ORDER BY id")
        .all()
        .map((r) => r.s);
    const before = sources();
    const previous = await setCameras(db, [1, 2], 2);
    expect(previous).toEqual([
      { id: 1, camera_id: 1, camera_source: "file" },
      { id: 2, camera_id: null, camera_source: null },
    ]);
    expect(sources()).toEqual([
      '{"taken_at":"exif","camera":"manual"}',
      '{"camera":"manual"}',
      '{"camera":"file"}',
    ]);
    // Another edit marks photo 1's スキャン機材 meanwhile: that stays.
    raw.exec(
      `UPDATE media SET metadata_source = json_set(metadata_source, '$.digitized_with', 'manual') WHERE id = 1`,
    );
    await restoreCameras(db, previous);
    expect(sources()).toEqual([
      '{"taken_at":"exif","camera":"file","digitized_with":"manual"}',
      before[1],
      before[2],
    ]);
    // Taken off on the camera page: manual too, so it is not linked again.
    const off = await removeCameraFrom(db, 2, [3]);
    expect(off).toEqual([{ id: 3, camera_id: 2, camera_source: "file" }]);
    expect(sources()[2]).toBe('{"camera":"manual"}');
  });

  it("refuses a camera that does not exist", async () => {
    const { db, cameras } = setup();
    await expect(setCameras(db, [1], 99)).rejects.toBeInstanceOf(
      UnknownCameraError,
    );
    expect(cameras()).toEqual([1, null, 2]);
  });
});

describe("the API's content version", () => {
  const version = (raw: ReturnType<typeof setup>["raw"]) =>
    (
      raw
        .prepare("SELECT value FROM setting WHERE key = 'content_version'")
        .get() as { value: string } | undefined
    )?.value;

  it("is bumped by every write here", async () => {
    const { db, raw } = setup();
    let info: InfoUndoRow[] = [];
    const writes: (() => Promise<unknown>)[] = [
      async () => {
        info = (await setInfo(db, [1], { exif: { iso: 200 } })).previous;
        expect(info).toHaveLength(1);
      },
      () => restoreInfo(db, info),
      () => setCameras(db, [1, 2], 2),
      () =>
        restoreCameras(db, [{ id: 2, camera_id: null, camera_source: null }]),
      () => setPlatforms(db, [1], "VRChat"),
      () => restorePlatforms(db, [{ id: 1, platform: "Real" }]),
      () => removeCameraFrom(db, 2, [3]),
    ];
    let last = version(raw);
    for (const write of writes) {
      await write();
      const now = version(raw);
      expect(now).toBeDefined();
      expect(now).not.toBe(last);
      last = now;
    }
  });

  it("is bumped in the same batch: not when the change fails", async () => {
    const { db, raw } = setup();
    // A camera that does not exist fails the foreign key: nothing commits.
    await expect(
      restoreCameras(db, [{ id: 1, camera_id: 99, camera_source: null }]),
    ).rejects.toThrow();
    expect(version(raw)).toBeUndefined();
  });
});
