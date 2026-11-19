import { describe, expect, it } from "vitest";
import {
  ensureTags,
  getSiteDefaults,
  listTags,
  publicTags,
  restoreMetadataLevels,
  setMetadataLevels,
  setSiteDefaults,
  setTagPublic,
} from "./db-meta";
import { BUILTIN_DEFAULTS } from "./metadata";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform, tags) VALUES
      (1, '/a.png', 'Real', '["night","film"]'),
      (2, '/b.png', 'Real', '["night"]'),
      (3, '/c.png', 'Real', '["gone"]');
    UPDATE media SET trashed_at = '2026-01-01T00:00:00Z' WHERE id = 3;
    INSERT INTO tag (name, public) VALUES ('night', 1), ('unused', 0);
  `);
  return { raw, db: sqliteD1(raw) };
};

describe("site defaults", () => {
  it("reads and writes them", async () => {
    const { db } = setup();
    expect(await getSiteDefaults(db)).toEqual(BUILTIN_DEFAULTS);
    await setSiteDefaults(db, { ...BUILTIN_DEFAULTS, taken_at: "date" });
    expect((await getSiteDefaults(db)).taken_at).toBe("date");
  });
});

describe("bulk metadata levels", () => {
  const levels = (raw: ReturnType<typeof setup>["raw"]) =>
    raw
      .prepare("SELECT id, metadata_visibility AS v FROM media ORDER BY id")
      .all()
      .map((r) => r.v);

  it("changes only the given fields, and undoes to what was stored", async () => {
    const { raw, db } = setup();
    raw.exec(
      `UPDATE media SET metadata_visibility = '{"taken_at":"date"}' WHERE id = 1`,
    );
    const previous = await setMetadataLevels(db, [1, 2], {
      camera: "hidden",
      taken_at: "",
    });
    expect(levels(raw)).toEqual([
      '{"camera":"hidden"}',
      '{"camera":"hidden"}',
      null,
    ]);
    expect(previous).toEqual([
      { id: 1, levels: '{"taken_at":"date"}' },
      { id: 2, levels: null },
    ]);
    // Setting them again changes nothing, so there is nothing to undo.
    expect(await setMetadataLevels(db, [1, 2], { camera: "hidden" })).toEqual(
      [],
    );
    await restoreMetadataLevels(db, previous);
    expect(levels(raw)).toEqual(['{"taken_at":"date"}', null, null]);
  });

  it("leaves photos alone that already have the levels in another order", async () => {
    const { raw, db } = setup();
    raw.exec(
      `UPDATE media SET metadata_visibility = '{"tags":"hidden","camera":"hidden"}' WHERE id = 1`,
    );
    expect(await setMetadataLevels(db, [1], { camera: "hidden" })).toEqual([]);
    expect(levels(raw)[0]).toBe('{"tags":"hidden","camera":"hidden"}');
  });
});

describe("tags", () => {
  it("lists tags in the table and on photos (not trashed ones), with counts", async () => {
    const { db } = setup();
    expect(await listTags(db)).toEqual([
      { name: "film", public: false, count: 1 },
      { name: "night", public: true, count: 2 },
      { name: "unused", public: false, count: 0 },
    ]);
  });

  it("counts the tags cameras pass on, once per photo", async () => {
    const { raw, db } = setup();
    raw.exec(`
      INSERT INTO camera (id, slug, name) VALUES (1, 'sp', 'SP'), (2, 'gr', 'GR');
      UPDATE media SET camera_id = 1 WHERE id IN (1, 3);
      UPDATE media SET camera_id = 2 WHERE id = 2;
      INSERT INTO camera_tag (camera_id, tag, propagate) VALUES
        (1, 'film', 1), (1, 'kept', 0), (2, 'film', 1), (2, 'night', 1);
    `);
    // film: photo 1 (own and from its camera) and photo 2 (camera); the
    // trashed photo 3 not. night: still 2. kept: on the camera only.
    expect(await listTags(db)).toEqual([
      { name: "film", public: false, count: 2 },
      { name: "kept", public: false, count: 0 },
      { name: "night", public: true, count: 2 },
      { name: "unused", public: false, count: 0 },
    ]);
  });

  it("reaches the cameras' photos through the camera_id index", () => {
    const { raw } = setup();
    const plan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT media.id, ct.tag FROM camera_tag ct
         CROSS JOIN media ON media.camera_id = ct.camera_id
         WHERE ct.propagate = 1 AND status = 'ready' AND trashed_at IS NULL`,
      )
      .all()
      .map((r) => String((r as { detail: string }).detail));
    expect(plan.join("\n")).toMatch(
      /SEARCH media USING INDEX idx_media_camera_id/,
    );
  });

  it("marks a tag public or private", async () => {
    const { db } = setup();
    await setTagPublic(db, "film", true);
    await setTagPublic(db, "night", false);
    expect(await publicTags(db, ["film", "night", "x"])).toEqual(["film"]);
  });

  it("adds new tags as private and says which were new", async () => {
    const { db } = setup();
    expect(await ensureTags(db, ["night", "new1", "new2"])).toEqual([
      "new1",
      "new2",
    ]);
    expect(await publicTags(db, ["new1", "night"])).toEqual(["night"]);
    expect(await ensureTags(db, [])).toEqual([]);
  });
});
