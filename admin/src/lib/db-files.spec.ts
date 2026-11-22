import { describe, expect, it } from "vitest";
import {
  CREATE_FOLDER_SQL,
  createFolder,
  filesQuery,
  folderRange,
  listFolders,
  listMediaFiles,
  listPhotosUnder,
  outermostFolders,
  PHOTOS_UNDER_SQL,
} from "./db-files";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

describe("filesQuery", () => {
  it("selects only what the files view needs, by path, one past the limit", () => {
    expect(filesQuery({ limit: 10 })).toEqual({
      sql: "SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp, camera_id, tags FROM media WHERE status = 'ready' AND trashed_at IS NULL ORDER BY path LIMIT ?",
      args: [11],
    });
  });

  it("applies the platform filter and an escaped substring of the path", () => {
    expect(filesQuery({ platform: "VRChat", q: "50%_x", limit: 5 })).toEqual({
      sql: "SELECT id, file, path, platform, visibility, size, metadata_visibility, timestamp, camera_id, tags FROM media WHERE status = 'ready' AND trashed_at IS NULL AND platform = ? AND path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?",
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

  it("counts only what is below the folder, not names that start alike", async () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (file, platform) VALUES ('/a-b/x.png', 'Real');
      INSERT INTO media (file, platform) VALUES ('/a.b/x.png', 'Real');
      INSERT INTO media (file, platform) VALUES ('/a0/x.png', 'Real');
      INSERT INTO folder (path) VALUES ('/c-d'), ('/c0');`);
    const db = sqliteD1(raw);
    expect(await createFolder(db, "/a")).toBe(true);
    expect(await createFolder(db, "/c")).toBe(true);
    raw.exec("INSERT INTO folder (path) VALUES ('/e/f')");
    expect(await createFolder(db, "/e")).toBe(false);
  });

  it("reads ranges of the path indexes, not every path", () => {
    const raw = migratedSqlite();
    const plan = (
      raw.prepare(`EXPLAIN QUERY PLAN ${CREATE_FOLDER_SQL}`).all("/a") as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/SCAN (media|folder)\b/);
    expect(plan).toMatch(/SEARCH media USING INDEX idx_media_path_live/);
    expect(plan).toMatch(/SEARCH folder USING COVERING INDEX/);
  });
});

describe("folderRange", () => {
  it("bounds the paths below a folder, the root being everything", () => {
    expect(folderRange("/a/b")).toEqual(["/a/b/", "/a/b0"]);
    expect(folderRange("/")).toEqual(["/", "0"]);
  });
});

describe("outermostFolders", () => {
  it("drops repeats and folders inside another, in path order", () => {
    expect(outermostFolders(["/a", "/a/b", "/a-b", "/a", "/c/d"])).toEqual([
      "/a-b",
      "/a",
      "/c/d",
    ]);
    expect(outermostFolders(["/a", "/"])).toEqual(["/"]);
  });
});

describe("listPhotosUnder (on the real schema)", () => {
  const setup = () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (id, file, platform) VALUES
        (1, '/a/x.png', 'Real'), (2, '/a/b/y.png', 'Real'),
        (3, '/a/b/c/z.png', 'Real'), (4, '/a-b/n.png', 'Real'),
        (5, '/a0/n.png', 'Real'), (6, '/d/w.png', 'Real'),
        (7, '/a/t.png', 'Real'), (8, '/x/u.png', 'Real');
      INSERT INTO media (id, file, platform, status) VALUES (9, '/a/up.png', 'Real', 'uploading');
      UPDATE media SET trashed_at = '2026-01-01' WHERE id = 7;
      UPDATE media SET path = '/a/b/moved.png' WHERE id = 8;`);
    return { raw, db: sqliteD1(raw) };
  };

  it("takes every live photo below the folders, subfolders included, once", async () => {
    const { db } = setup();
    const { rows, truncated } = await listPhotosUnder(db, ["/a", "/a/b", "/d"]);
    expect(rows.map((r) => r.id)).toEqual([3, 8, 2, 1, 6]);
    expect(truncated).toBe(false);
    expect((await listPhotosUnder(db, [])).rows).toEqual([]);
  });

  it("in path order across folders whose names start alike", async () => {
    const { db } = setup();
    const { rows } = await listPhotosUnder(db, ["/a", "/a-b"]);
    expect(rows.map((r) => r.path)).toEqual([
      "/a-b/n.png",
      "/a/b/c/z.png",
      "/a/b/moved.png",
      "/a/b/y.png",
      "/a/x.png",
    ]);
  });

  it("reads each photo once however the folders repeat or nest", async () => {
    const { db } = setup();
    let read = 0;
    const counting = {
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          bind: (...args: unknown[]) => {
            const bound = stmt.bind(...args);
            return {
              all: async <T>() => {
                const r = await bound.all<T>();
                read += r.results?.length ?? 0;
                return r;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    await listPhotosUnder(counting, ["/a/b", "/a", "/a", "/a/b/c"]);
    expect(read).toBe(4);
    // Past the limit it stops: no more than the limit and one per folder.
    read = 0;
    expect((await listPhotosUnder(counting, ["/a", "/d"], 2)).truncated).toBe(
      true,
    );
    expect(read).toBe(3);
  });

  it("says when there are more than the limit", async () => {
    const { db } = setup();
    const r = await listPhotosUnder(db, ["/a"], 2);
    expect(r.rows).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect((await listPhotosUnder(db, ["/a"], 4)).truncated).toBe(false);
  });

  it("reads a range of the path index", () => {
    const { raw } = setup();
    const plan = (
      raw
        .prepare(`EXPLAIN QUERY PLAN ${PHOTOS_UNDER_SQL}`)
        .all("/a/", "/a0", 11) as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(
      /SEARCH media USING INDEX idx_media_path_live \(path>\? AND path<\?\)/,
    );
    expect(plan).not.toMatch(/SCAN|TEMP B-TREE/);
  });
});
