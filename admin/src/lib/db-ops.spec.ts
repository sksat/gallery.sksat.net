import { describe, expect, it, vi } from "vitest";
import {
  listTrash,
  loadTree,
  moveItems,
  purgeItems,
  RestoreError,
  restoreItems,
  trashItems,
} from "./db-ops";
import { intoFolder, undoMoves } from "./file-ops";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform, size) VALUES
      (1, '/V/a.png', 'VRChat', 10),
      (2, '/V/b.png', 'VRChat', 20),
      (3, '/V/sub/c.png', 'VRChat', 30),
      (4, '/R/x.jpg', 'Real', 40);
    INSERT INTO folder (path) VALUES ('/V/sub/empty'), ('/R/kept');
  `);
  return { raw, db: sqliteD1(raw) };
};

const paths = (raw: ReturnType<typeof migratedSqlite>) =>
  raw.prepare("SELECT id, file, path FROM media ORDER BY id").all();

describe("moveItems", () => {
  it("rewrites display paths and folder rows only, in one go", async () => {
    const { raw, db } = setup();
    const r = await moveItems(
      db,
      intoFolder(await loadTree(db), "/R", {
        photos: [1],
        folders: ["/V/sub"],
      }),
    );
    expect(r.ok).toBe(true);
    expect(paths(raw)).toEqual([
      { id: 1, file: "/V/a.png", path: "/R/a.png" },
      { id: 2, file: "/V/b.png", path: "/V/b.png" },
      { id: 3, file: "/V/sub/c.png", path: "/R/sub/c.png" },
      { id: 4, file: "/R/x.jpg", path: "/R/x.jpg" },
    ]);
    expect(raw.prepare("SELECT path FROM folder ORDER BY path").all()).toEqual([
      { path: "/R/kept" },
      { path: "/R/sub/empty" },
      // Where photo 1 was: kept even once it empties.
      { path: "/V" },
    ]);
  });

  it("keeps the folder a photo left, and can be undone", async () => {
    const { raw, db } = setup();
    const r = await moveItems(
      db,
      intoFolder(await loadTree(db), "/", { photos: [4], folders: [] }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.keep).toEqual(["/R"]);
    expect(
      raw.prepare("SELECT path FROM folder WHERE path = '/R'").get(),
    ).toEqual({ path: "/R" });
    expect((await moveItems(db, undoMoves(r.plan))).ok).toBe(true);
    expect(paths(raw)[3]).toEqual({
      id: 4,
      file: "/R/x.jpg",
      path: "/R/x.jpg",
    });
  });

  it("refuses a taken name and changes nothing", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET path = '/R/a.png' WHERE id = 4");
    expect(
      await moveItems(db, [{ kind: "photo", id: 1, to: "/R/a.png" }]),
    ).toEqual({ ok: false, error: "/R/a.png はすでにあります" });
    expect(paths(raw)[0]).toMatchObject({ path: "/V/a.png" });
  });

  it("swaps two names (the unique index is checked row by row)", async () => {
    const { raw, db } = setup();
    const r = await moveItems(db, [
      { kind: "photo", id: 1, to: "/V/b.png" },
      { kind: "photo", id: 2, to: "/V/a.png" },
    ]);
    expect(r.ok).toBe(true);
    expect(paths(raw).slice(0, 2)).toMatchObject([
      { id: 1, path: "/V/b.png" },
      { id: 2, path: "/V/a.png" },
    ]);
  });
});

describe("trash", () => {
  it("trashes photos and folders with their contents, and restores them", async () => {
    const { raw, db } = setup();
    const t = await trashItems(db, { photos: [4], folders: ["/V/sub"] });
    expect(t).toEqual({ ids: [3, 4], folders: ["/V/sub/empty"] });
    expect((await loadTree(db)).photos.map((p) => p.id)).toEqual([1, 2]);
    const trash = await listTrash(db);
    expect(trash.rows.map((r) => r.id).sort()).toEqual([3, 4]);
    expect(trash.bytes).toBe(70);

    // Undo: back where they were, the folder row too.
    expect(await restoreItems(db, t.ids, t.folders)).toEqual({
      restored: [
        { id: 3, path: "/V/sub/c.png" },
        { id: 4, path: "/R/x.jpg" },
      ],
    });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM folder").get()).toEqual({
      n: 2,
    });
    expect((await listTrash(db)).rows).toEqual([]);
  });

  it("restores to a numbered name when the place was taken", async () => {
    const { raw, db } = setup();
    await trashItems(db, { photos: [1], folders: [] });
    raw.exec("UPDATE media SET path = '/V/a.png' WHERE id = 2");
    expect(await restoreItems(db, [1])).toEqual({
      restored: [{ id: 1, path: "/V/a-1.png" }],
    });
  });

  it("does not restore onto a folder's path", async () => {
    const { raw, db } = setup();
    await trashItems(db, { photos: [3], folders: [] });
    raw.exec("UPDATE media SET path = '/V/sub/c.png/d.png' WHERE id = 2");
    expect(await restoreItems(db, [3])).toEqual({
      restored: [{ id: 3, path: "/V/sub/c-1.png" }],
    });
  });

  it("refuses a restore when every numbered name is taken", async () => {
    const { raw, db } = setup();
    await trashItems(db, { photos: [1], folders: [] });
    raw.exec(`INSERT INTO media (file, platform) VALUES ('/V/a.png.x', 'VRChat');
      UPDATE media SET path = '/V/a.png' WHERE file = '/V/a.png.x';`);
    for (let i = 1; i <= 60; i++) {
      raw.exec(
        `INSERT INTO media (file, platform) VALUES ('/V/a-${i}.png', 'VRChat')`,
      );
    }
    await expect(restoreItems(db, [1])).rejects.toThrow(RestoreError);
    expect((await listTrash(db)).rows.map((r) => r.id)).toEqual([1]);
  });

  it("leaves unfinished uploads out of a folder's trash", async () => {
    const { raw, db } = setup();
    raw.exec(
      "INSERT INTO media (id, file, platform, status) VALUES (9, '/V/up.png', 'VRChat', 'uploading')",
    );
    const t = await trashItems(db, { photos: [], folders: ["/V"] });
    expect(t.ids).toEqual([1, 2, 3]);
    expect(
      raw.prepare("SELECT trashed_at FROM media WHERE id = 9").get(),
    ).toEqual({ trashed_at: null });
  });
});

describe("purgeItems", () => {
  it("deletes the object, then the row; only trashed photos", async () => {
    const { raw, db } = setup();
    await trashItems(db, { photos: [1, 2], folders: [] });
    const remove = vi.fn(async (o: { key: string }) => {
      if (o.key === "/V/b.png") throw new Error("削除の権限がありません");
    });
    expect(await purgeItems(db, [1, 2, 3], remove)).toEqual({
      deleted: [1],
      failed: [{ id: 2, error: "削除の権限がありません" }],
    });
    expect(remove.mock.calls.map((c) => c[0])).toEqual([
      { storage: "b2", key: "/V/a.png", mediaId: 1, shared: false },
      { storage: "b2", key: "/V/b.png", mediaId: 2, shared: false },
    ]);
    expect(paths(raw).map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it("deletes every file of a photo, then its file rows with it", async () => {
    const { raw, db } = setup();
    raw.exec(`INSERT INTO media_file (id, media_id, role, storage, object_key, source_file_id, status) VALUES
      (100, 1, 'edit', 'b2', '/V/a_lightroom.jpg', 1, 'ready'),
      (101, 1, 'display', 'b2', '/V/a_lightroom.d.jpg', 100, 'ready'),
      (102, 2, 'edit', 'r2', '/V/b_ON1.png', NULL, 'ready');
      UPDATE media SET active_file_id = 100 WHERE id = 1;`);
    await trashItems(db, { photos: [1, 2], folders: [] });
    const removed: string[] = [];
    const remove = async (o: { key: string }) => {
      removed.push(o.key);
    };
    // R2 has no binding yet: photo 2 is left whole, nothing of it deleted.
    expect(await purgeItems(db, [1, 2], remove)).toEqual({
      deleted: [1],
      failed: [{ id: 2, error: "r2 のファイルはまだ削除できません" }],
    });
    expect(removed).toEqual([
      "/V/a.png",
      "/V/a_lightroom.jpg",
      "/V/a_lightroom.d.jpg",
    ]);
    expect(
      raw
        .prepare(
          "SELECT media_id, object_key FROM media_file WHERE media_id IN (1, 2) ORDER BY id",
        )
        .all(),
    ).toEqual([
      { media_id: 2, object_key: "/V/b.png" },
      { media_id: 2, object_key: "/V/b_ON1.png" },
    ]);
  });

  it("keeps the object of a file that is also a camera picture", async () => {
    const { raw, db } = setup();
    raw.exec(`INSERT INTO camera (id, slug, name) VALUES (1, 'c', 'C');
      INSERT INTO camera_image (camera_id, file) VALUES (1, '/V/a.png');`);
    await trashItems(db, { photos: [1], folders: [] });
    const remove = vi.fn(async () => {});
    expect(await purgeItems(db, [1], remove)).toEqual({
      deleted: [1],
      failed: [],
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
