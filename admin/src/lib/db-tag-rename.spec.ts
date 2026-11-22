import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listTags } from "./db-meta";
import { listTagFields } from "./db-tag-field";
import {
  FIND_TAGGED_SQL,
  renameTag,
  SET_TAGS_SQL,
  unrenameTag,
  type TagRename,
} from "./db-tag-rename";
import { CONTENT_VERSION_KEY } from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { UPLOAD_RULES_KEY } from "./upload-rules";

const RULES = JSON.stringify([
  {
    id: "r1",
    name: "",
    enabled: true,
    conditions: { folder: "/Film" },
    actions: { tags: ["フィルム", "旅"] },
  },
  {
    id: "r2",
    name: "",
    enabled: true,
    conditions: { folder: "/VRChat" },
    actions: { platform: "VRChat" },
  },
]);

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'rollei', 'Rollei'), (2, 'gr', 'GR');
    INSERT INTO tag (id, name, public) VALUES (1, '旅', 1), (2, '旅行', 0), (3, 'フィルム', 1);
    INSERT INTO media (id, file, platform, tags, camera_id, status, trashed_at) VALUES
      (1, '/a.jpg', 'Real', '["旅","海"]', 1, 'ready', NULL),
      (2, '/b.jpg', 'Real', '["旅行","旅"]', 2, 'ready', NULL),
      (3, '/c.jpg', 'Real', '["海"]', 2, 'ready', NULL),
      (4, '/d.jpg', 'Real', '["旅"]', NULL, 'ready', '2026-01-01T00:00:00Z'),
      (5, '/e.jpg', 'Real', '["旅行"]', NULL, 'ready', NULL);
    INSERT INTO camera_tag (camera_id, tag, propagate, position) VALUES
      (1, '旅', 1, 0), (1, 'フィルム', 0, 1),
      (2, '旅行', 0, 0), (2, '旅', 1, 1);
    INSERT INTO tag_field (id, tag_id, label, type) VALUES (10, 1, '行き先', 'text');
    UPDATE media SET tag_values = '{"10":"京都"}' WHERE id = 1;
  `);
  raw
    .prepare("INSERT INTO setting (key, value) VALUES (?, ?)")
    .run(UPLOAD_RULES_KEY, RULES);
  return { raw, db: sqliteD1(raw) };
};

const tagsOf = (raw: DatabaseSync) =>
  Object.fromEntries(
    (
      raw.prepare("SELECT id, tags FROM media ORDER BY id").all() as {
        id: number;
        tags: string;
      }[]
    ).map((r) => [r.id, JSON.parse(r.tags) as string[]]),
  );

const cameraTags = (raw: DatabaseSync) =>
  raw
    .prepare(
      "SELECT camera_id, tag, propagate, position FROM camera_tag ORDER BY camera_id, position, tag",
    )
    .all();

const tagRows = (raw: DatabaseSync) =>
  raw.prepare("SELECT id, name, public FROM tag ORDER BY id").all();

const rules = (raw: DatabaseSync) =>
  (
    raw
      .prepare("SELECT value FROM setting WHERE key = ?")
      .get(UPLOAD_RULES_KEY) as { value: string }
  ).value;

const version = (raw: DatabaseSync) =>
  (
    raw
      .prepare("SELECT value FROM setting WHERE key = ?")
      .get(CONTENT_VERSION_KEY) as { value: string } | undefined
  )?.value;

const snapshot = (raw: DatabaseSync) => ({
  tags: tagsOf(raw),
  cameras: cameraTags(raw),
  rows: tagRows(raw),
  rules: rules(raw),
  fields: raw.prepare("SELECT id, tag_id, label FROM tag_field").all(),
});

const ok = (r: Awaited<ReturnType<typeof renameTag>>): TagRename => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("renameTag", () => {
  it("renames the row, the photos (trash too), cameras and rules, keeping fields", async () => {
    const { raw, db } = setup();
    const r = ok(await renameTag(db, "旅", "たび", false));
    expect(r.merged).toBe(false);
    expect(tagsOf(raw)).toEqual({
      1: ["たび", "海"],
      2: ["旅行", "たび"],
      3: ["海"],
      4: ["たび"],
      5: ["旅行"],
    });
    expect(tagRows(raw)).toContainEqual({ id: 1, name: "たび", public: 1 });
    expect(cameraTags(raw)).toEqual([
      { camera_id: 1, tag: "たび", propagate: 1, position: 0 },
      { camera_id: 1, tag: "フィルム", propagate: 0, position: 1 },
      { camera_id: 2, tag: "旅行", propagate: 0, position: 0 },
      { camera_id: 2, tag: "たび", propagate: 1, position: 1 },
    ]);
    expect(JSON.parse(rules(raw))[0].actions.tags).toEqual([
      "フィルム",
      "たび",
    ]);
    expect(JSON.parse(rules(raw))[1]).toEqual(JSON.parse(RULES)[1]);
    const fields = await listTagFields(db);
    expect(fields.map((f) => [f.id, f.tag])).toEqual([[10, "たび"]]);
    expect(version(raw)).toBeDefined();
  });

  it("undoes a rename exactly", async () => {
    const { raw, db } = setup();
    const before = snapshot(raw);
    const r = ok(await renameTag(db, "旅", "たび", false));
    const v = version(raw);
    expect(await unrenameTag(db, r)).toEqual({ ok: true });
    expect(snapshot(raw)).toEqual(before);
    expect(version(raw)).not.toBe(v);
  });

  it("asks before merging, then merges into the target", async () => {
    const { raw, db } = setup();
    expect(await renameTag(db, "旅", "旅行", false)).toMatchObject({
      ok: false,
      code: "exists",
    });
    expect(version(raw)).toBeUndefined();
    const r = ok(await renameTag(db, "旅", "旅行", true));
    expect(r.merged).toBe(true);
    expect(tagsOf(raw)).toEqual({
      1: ["旅行", "海"],
      2: ["旅行"],
      3: ["海"],
      4: ["旅行"],
      5: ["旅行"],
    });
    // The target's flag (private) is kept; 旅's row goes, its field moves.
    expect(tagRows(raw)).toEqual([
      { id: 2, name: "旅行", public: 0 },
      { id: 3, name: "フィルム", public: 1 },
    ]);
    expect((await listTagFields(db)).map((f) => [f.id, f.tag])).toEqual([
      [10, "旅行"],
    ]);
    // Camera 2 had both: one row, passed on as 旅 was.
    expect(cameraTags(raw)).toEqual([
      { camera_id: 1, tag: "旅行", propagate: 1, position: 0 },
      { camera_id: 1, tag: "フィルム", propagate: 0, position: 1 },
      { camera_id: 2, tag: "旅行", propagate: 1, position: 0 },
    ]);
    expect((await listTags(db)).find((t) => t.name === "旅行")?.count).toBe(4); // Photos 1, 2 and 5 (4 is in the trash); 3 by its camera.
  });

  it("undoes a merge exactly", async () => {
    const { raw, db } = setup();
    const before = snapshot(raw);
    const r = ok(await renameTag(db, "旅", "旅行", true));
    expect(await unrenameTag(db, r)).toEqual({ ok: true });
    expect(snapshot(raw)).toEqual(before);
  });

  it("keeps photo edits made after the rename when undoing", async () => {
    const { raw, db } = setup();
    const r = ok(await renameTag(db, "旅", "たび", false));
    raw.exec(`UPDATE media SET tags = '["たび","海","夏"]' WHERE id = 1`);
    expect(await unrenameTag(db, r)).toEqual({ ok: true });
    expect(tagsOf(raw)[1]).toEqual(["旅", "海", "夏"]);
  });

  it("refuses to merge two tags that both have fields", async () => {
    const { raw, db } = setup();
    raw.exec(
      "INSERT INTO tag_field (id, tag_id, label, type) VALUES (11, 2, '日数', 'number')",
    );
    expect(await renameTag(db, "旅", "旅行", true)).toMatchObject({
      ok: false,
      code: "fields",
    });
    expect(tagsOf(raw)[1]).toEqual(["旅", "海"]);
  });

  it("merges into a name only on photos (no row): private", async () => {
    const { raw, db } = setup();
    raw.exec(`UPDATE media SET tags = '["秋"]' WHERE id = 3`);
    const before = snapshot(raw);
    const r = ok(await renameTag(db, "旅", "秋", true));
    expect(r.merged).toBe(true);
    expect(tagRows(raw)).toContainEqual({ id: 1, name: "秋", public: 0 });
    expect(await unrenameTag(db, r)).toEqual({ ok: true });
    expect(snapshot(raw)).toEqual(before);
  });

  it("renames a tag only on photos, without a row", async () => {
    const { raw, db } = setup();
    raw.exec(`UPDATE media SET tags = '["秋"]' WHERE id = 3`);
    const r = ok(await renameTag(db, "秋", "夏", false));
    expect(r.fromRow).toBeNull();
    expect(tagsOf(raw)[3]).toEqual(["夏"]);
    expect(tagRows(raw)).toHaveLength(3);
  });

  it("refuses an unknown tag and the same name", async () => {
    const { db } = setup();
    expect(await renameTag(db, "無い", "x", false)).toMatchObject({
      code: "missing",
    });
    expect(await renameTag(db, "旅", "旅", false)).toMatchObject({
      code: "same",
    });
  });

  it("writes nothing when a photo changed between the read and the write", async () => {
    const { raw, db } = setup();
    const before = snapshot(raw);
    let calls = 0;
    // A D1 batch is a transaction (sqliteD1's is not), and an edit lands
    // after the read batch.
    const racing = {
      prepare: db.prepare.bind(db),
      batch: async (stmts: D1PreparedStatement[]) => {
        if (calls++ === 1) {
          raw.exec(`UPDATE media SET tags = '["旅","海","夏"]' WHERE id = 1`);
        }
        raw.exec("BEGIN");
        try {
          const out = await db.batch(stmts);
          raw.exec("COMMIT");
          return out;
        } catch (err) {
          raw.exec("ROLLBACK");
          throw err;
        }
      },
    } as unknown as D1Database;
    expect(await renameTag(racing, "旅", "たび", false)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(snapshot(raw)).toEqual({
      ...before,
      tags: { ...before.tags, 1: ["旅", "海", "夏"] },
    });
    // Again: done.
    expect((await renameTag(racing, "旅", "たび", false)).ok).toBe(true);
    expect(tagsOf(raw)[1]).toEqual(["たび", "海", "夏"]);
  });

  it("keeps camera tag changes made after a merge when undoing", async () => {
    const { raw, db } = setup();
    const r = ok(await renameTag(db, "旅", "旅行", true));
    // Camera 2's 旅行 (passed on by the merge) set back by hand.
    raw.exec(
      "UPDATE camera_tag SET propagate = 0 WHERE camera_id = 2 AND tag = '旅行'",
    );
    // Camera 1's (renamed) moved.
    raw.exec(
      "UPDATE camera_tag SET position = 5 WHERE camera_id = 1 AND tag = '旅行'",
    );
    expect(await unrenameTag(db, r)).toEqual({ ok: true });
    expect(cameraTags(raw)).toEqual([
      { camera_id: 1, tag: "フィルム", propagate: 0, position: 1 },
      { camera_id: 1, tag: "旅", propagate: 1, position: 5 },
      { camera_id: 2, tag: "旅行", propagate: 0, position: 0 },
      { camera_id: 2, tag: "旅", propagate: 1, position: 1 },
    ]);
  });

  it("will not undo onto a tag that took the old name meanwhile", async () => {
    const { raw, db } = setup();
    const r = ok(await renameTag(db, "旅", "たび", false));
    raw.exec("INSERT INTO tag (name) VALUES ('旅')");
    expect((await unrenameTag(db, r)).ok).toBe(false);
    expect(tagsOf(raw)[1]).toEqual(["たび", "海"]);
  });

  it("finds the photos in one pass over media", async () => {
    const { raw } = setup();
    const plan = raw
      .prepare(`EXPLAIN QUERY PLAN ${FIND_TAGGED_SQL}`)
      .all("a", "b") as { detail: string }[];
    expect(plan.filter((p) => p.detail.startsWith("SCAN media"))).toHaveLength(
      1,
    );
  });

  it("writes the photos by primary key, the list read once", async () => {
    const { raw } = setup();
    const plan = raw
      .prepare(`EXPLAIN QUERY PLAN ${SET_TAGS_SQL}`)
      .all("[]") as { detail: string }[];
    expect(plan.map((p) => p.detail)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^SEARCH media USING INTEGER PRIMARY KEY/),
      ]),
    );
    expect(plan.some((p) => p.detail.startsWith("SCAN media"))).toBe(false);
  });
});
