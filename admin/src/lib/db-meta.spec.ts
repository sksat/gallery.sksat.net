import { describe, expect, it } from "vitest";
import {
  ensureTags,
  getSiteDefaults,
  listTags,
  publicTags,
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

describe("tags", () => {
  it("lists tags in the table and on photos (not trashed ones), with counts", async () => {
    const { db } = setup();
    expect(await listTags(db)).toEqual([
      { name: "film", public: false, count: 1 },
      { name: "night", public: true, count: 2 },
      { name: "unused", public: false, count: 0 },
    ]);
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
