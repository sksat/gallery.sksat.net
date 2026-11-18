import { describe, expect, it } from "vitest";
import {
  createFolder,
  filesQuery,
  listFolders,
  listMediaFiles,
} from "./db-files";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

describe("filesQuery", () => {
  it("selects only what the files view needs, by path, one past the limit", () => {
    expect(filesQuery({ limit: 10 })).toEqual({
      sql: "SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp FROM media WHERE status = 'ready' AND trashed_at IS NULL ORDER BY path LIMIT ?",
      args: [11],
    });
  });

  it("applies the platform filter and an escaped substring of the path", () => {
    expect(filesQuery({ platform: "VRChat", q: "50%_x", limit: 5 })).toEqual({
      sql: "SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp FROM media WHERE status = 'ready' AND trashed_at IS NULL AND platform = ? AND path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?",
      args: ["VRChat", "%50\\%\\_x%", 6],
    });
  });
});

// Minimal D1 stand-in: returns `results` for any statement.
const fakeDb = (results: unknown[]) =>
  ({
    prepare: () => ({
      bind: () => ({ all: async () => ({ results }) }),
    }),
  }) as unknown as D1Database;

describe("listMediaFiles", () => {
  const row = (id: number) => ({ id, file: `/a/${id}.png`, platform: "Real" });

  it("is not truncated up to the limit", async () => {
    const r = await listMediaFiles(fakeDb([row(1), row(2)]), { limit: 2 });
    expect(r).toEqual({ rows: [row(1), row(2)], truncated: false });
  });

  it("drops the extra row and reports truncation", async () => {
    const r = await listMediaFiles(fakeDb([row(1), row(2), row(3)]), {
      limit: 2,
    });
    expect(r).toEqual({ rows: [row(1), row(2)], truncated: true });
  });
});

describe("folders (on the real schema)", () => {
  const setup = () => {
    const db = migratedSqlite();
    db.exec(`INSERT INTO media (file, platform) VALUES ('/VRChat/2023-12/a.png', 'VRChat');
      INSERT INTO media (file, platform, status) VALUES ('/up/b.png', 'Real', 'uploading');`);
    return sqliteD1(db);
  };

  it("creates a folder once and lists it", async () => {
    const db = setup();
    expect(await createFolder(db, "/VRChat/2026-11")).toBe(true);
    expect(await createFolder(db, "/VRChat/2026-11")).toBe(false);
    expect(await createFolder(db, "/new")).toBe(true);
    // Plus the folder of the upload that has not completed.
    expect(await listFolders(db)).toEqual(["/VRChat/2026-11", "/new", "/up"]);
  });

  it("refuses a folder that already exists through a created subfolder", async () => {
    const db = setup();
    expect(await createFolder(db, "/a/b")).toBe(true);
    expect(await createFolder(db, "/a")).toBe(false);
  });

  it("refuses a folder that already exists through its files", async () => {
    const db = setup();
    expect(await createFolder(db, "/VRChat")).toBe(false);
    expect(await createFolder(db, "/VRChat/2023-12")).toBe(false);
    // Even if the only file is still being uploaded.
    expect(await createFolder(db, "/up")).toBe(false);
    // A prefix of a folder name is another folder.
    expect(await createFolder(db, "/VRCha")).toBe(true);
    expect(await createFolder(db, "/VRChat/2023-1")).toBe(true);
  });

  it("lists only ready photos in the files view", async () => {
    const db = setup();
    const { rows } = await listMediaFiles(db, { limit: 10 });
    expect(rows.map((r) => r.file)).toEqual(["/VRChat/2023-12/a.png"]);
  });

  it("follows where photos are shown, and leaves the trash out", async () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (file, platform, path) VALUES ('/x/a.png', 'Real', '/moved/a.png');
      INSERT INTO media (file, platform, trashed_at) VALUES ('/x/b.png', 'Real', '2026-01-01');`);
    const db = sqliteD1(raw);
    const { rows } = await listMediaFiles(db, { limit: 10 });
    expect(rows.map((r) => [r.file, r.path])).toEqual([
      ["/x/a.png", "/moved/a.png"],
    ]);
    // The folder of the moved photo exists; its old one does not.
    expect(await createFolder(db, "/moved")).toBe(false);
    expect(await createFolder(db, "/x")).toBe(true);
  });
});
