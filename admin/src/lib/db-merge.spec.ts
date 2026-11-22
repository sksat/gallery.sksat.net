import { describe, expect, it } from "vitest";
import {
  findSimilarPhoto,
  listMergeCandidates,
  MergeError,
  mergePhotos,
  NAMES_SQL,
  similarLookups,
  unmergePhoto,
} from "./db-merge";
import { listPhotoFiles } from "./db-retouch";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const sha = (c: string) => c.repeat(64);
const DIR = "/VRChat/2026-06";
const A = `${DIR}/VRChat_2026-06-04_03-20-34.513_4320x7680.png`;
const B = `${DIR}/VRChat_2026-06-04_03-20-34.513_4320x7680_DxO.jpg`;

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'vrc', 'VRChat');
    INSERT INTO tag (name, public) VALUES ('sky', 1), ('dxo', 1);
    INSERT INTO media (id, file, path, platform, public_id, sha256, size, visibility,
        timestamp, camera_id, tags, status) VALUES
      (1, '${A}', '${A}', 'VRChat', '2345678923', '${sha("1")}', 100, 'private',
       '2026-06-04T03:20:37.165+09:00', 1, '["sky"]', 'ready'),
      (2, '${B}', '${B}', 'VRChat', '3456789234', '${sha("2")}', 20, 'public',
       '2026-06-04T04:50:27+09:00', NULL, '["dxo","sky"]', 'ready'),
      (3, '/x/other.png', '/x/other.png', 'Real', '4567892345', '${sha("3")}', 5, 'public',
       NULL, NULL, '[]', 'ready');
    UPDATE media_file SET creator_tool = 'DxO PhotoLab 9.8.1', mime_type = 'image/jpeg',
      xmp_summary = '{"crs_count":3}' WHERE media_id = 2;
    INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status, size, sha256) VALUES
      (50, 2, 'display', '/.derived/3456789234-bbbb.jpg',
       (SELECT id FROM media_file WHERE media_id = 2 AND role = 'original'), 'ready', 9, '${sha("9")}');
  `);
  return { raw, db: sqliteD1(raw) };
};

const photo = (raw: ReturnType<typeof migratedSqlite>, id: number) =>
  raw.prepare("SELECT * FROM media WHERE id = ?").get(id) as
    Record<string, unknown> | undefined;

describe("listMergeCandidates", () => {
  it("pairs the retouch with its original, with what they share and the defaults", async () => {
    const { db } = setup();
    const c = await listMergeCandidates(db);
    expect(c).toHaveLength(1);
    expect(c[0].original.id).toBe(1);
    expect(c[0].retouch.id).toBe(2);
    expect(c[0].retouch.creatorTool).toBe("DxO PhotoLab 9.8.1");
    expect(c[0].signals).toEqual({
      sameTime: false,
      sameCamera: false,
      tool: "DxO PhotoLab 9.8.1",
    });
    expect(c[0].defaults).toEqual({ visibility: null, show: true });
  });

  it("walks the live paths by their index only", () => {
    const { raw } = setup();
    const plan = (
      raw.prepare(`EXPLAIN QUERY PLAN ${NAMES_SQL}`).all() as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(/idx_media_path_live/);
    expect(plan).not.toMatch(/TEMP B-TREE/);
  });
});

describe("mergePhotos", () => {
  it("moves the retouch's files to the original's photo and leaves an alias", async () => {
    const { raw, db } = setup();
    const before = photo(raw, 2);
    expect(
      await mergePhotos(db, {
        into: 1,
        from: 2,
        visibility: "public",
        show: true,
      }),
    ).toEqual({
      alias: "3456789234",
    });
    expect(photo(raw, 2)).toBeUndefined();
    const merged = photo(raw, 1);
    expect(merged).toMatchObject({
      public_id: "2345678923",
      visibility: "public",
      camera_id: 1,
      tags: '["sky","dxo"]',
      timestamp: "2026-06-04T03:20:37.165+09:00",
    });
    const files = await listPhotoFiles(db, 1);
    expect(
      files.map((f) => [f.role, f.key, f.thumbKey, f.shown, f.creatorTool]),
    ).toEqual([
      ["original", A, A, false, null],
      ["edit", B, "/.derived/3456789234-bbbb.jpg", true, "DxO PhotoLab 9.8.1"],
    ]);
    // Made from the original; the display copy from the edit.
    const edit = raw
      .prepare(
        "SELECT id, source_file_id, sha256, mime_type FROM media_file WHERE object_key = ?",
      )
      .get(B) as Record<string, unknown>;
    expect(edit.source_file_id).toBe(files[0].id);
    expect(edit.sha256).toBe(sha("2"));
    expect(
      raw
        .prepare(
          "SELECT source_file_id, media_id FROM media_file WHERE role = 'display'",
        )
        .get(),
    ).toEqual({ source_file_id: edit.id, media_id: 1 });
    expect(
      raw
        .prepare("SELECT public_id, media_id, redirect FROM media_alias")
        .all(),
    ).toEqual([{ public_id: "3456789234", media_id: 1, redirect: 1 }]);
    expect(
      raw
        .prepare("SELECT value FROM setting WHERE key = 'content_version'")
        .get(),
    ).toBeTruthy();

    // Undone: the photo comes back as it was.
    expect(await unmergePhoto(db, "3456789234")).toEqual({ id: 2, path: B });
    const back = photo(raw, 2);
    expect({ ...back, updated_at: null, resized_at: null }).toEqual({
      ...before,
      updated_at: null,
      resized_at: null,
    });
    expect(photo(raw, 1)).toMatchObject({
      visibility: "private",
      tags: '["sky"]',
      camera_id: 1,
      active_file_id: null,
    });
    expect((await listPhotoFiles(db, 1)).map((f) => f.key)).toEqual([A]);
    expect(
      (await listPhotoFiles(db, 2)).map((f) => [
        f.role,
        f.key,
        f.thumbKey,
        f.creatorTool,
      ]),
    ).toEqual([
      ["original", B, "/.derived/3456789234-bbbb.jpg", "DxO PhotoLab 9.8.1"],
    ]);
    expect(raw.prepare("SELECT count(*) AS n FROM media_alias").get()).toEqual({
      n: 0,
    });
  });

  it("keeps the shown file and the visibility when asked to", async () => {
    const { raw, db } = setup();
    await mergePhotos(db, {
      into: 1,
      from: 2,
      visibility: "private",
      show: false,
    });
    expect(photo(raw, 1)).toMatchObject({
      visibility: "private",
      active_file_id: null,
    });
  });

  it("never makes the original more visible unless asked", async () => {
    const { raw, db } = setup();
    // 2 (public) into 1 (private): stays private, but shows the retouch.
    await mergePhotos(db, { into: 1, from: 2 });
    expect(photo(raw, 1)).toMatchObject({ visibility: "private" });
    expect((await listPhotoFiles(db, 1)).find((f) => f.shown)?.key).toBe(B);
  });

  it("leaves a change made after the merge when it is undone", async () => {
    const { raw, db } = setup();
    await mergePhotos(db, {
      into: 1,
      from: 2,
      visibility: "public",
      show: true,
    });
    raw.exec(
      "UPDATE media SET visibility = 'unlisted', tags = '[\"x\"]' WHERE id = 1",
    );
    await unmergePhoto(db, "3456789234");
    expect(photo(raw, 1)).toMatchObject({
      visibility: "unlisted",
      tags: '["x"]',
      camera_id: 1,
    });
  });

  it("leads a private photo's id nowhere", async () => {
    const { raw, db } = setup();
    // 1 (private) into 3 (public): stays public, keeps its own file.
    await mergePhotos(db, { into: 3, from: 1 });
    expect(photo(raw, 3)).toMatchObject({
      visibility: "public",
      active_file_id: null,
    });
    expect(
      raw.prepare("SELECT public_id, redirect FROM media_alias").all(),
    ).toEqual([{ public_id: "2345678923", redirect: 0 }]);
  });

  it("carries earlier aliases along, and back", async () => {
    const { raw, db } = setup();
    raw.exec(
      `INSERT INTO media_alias (public_id, media_id) VALUES ('5678923456', 2)`,
    );
    await mergePhotos(db, {
      into: 1,
      from: 2,
      visibility: "public",
      show: true,
    });
    expect(
      raw
        .prepare(
          "SELECT public_id, media_id FROM media_alias ORDER BY public_id",
        )
        .all(),
    ).toEqual([
      { public_id: "3456789234", media_id: 1 },
      { public_id: "5678923456", media_id: 1 },
    ]);
    await unmergePhoto(db, "3456789234");
    expect(
      raw.prepare("SELECT public_id, media_id FROM media_alias").all(),
    ).toEqual([{ public_id: "5678923456", media_id: 2 }]);
  });

  it("refuses itself, a photo gone, a camera picture and an unfinished upload", async () => {
    const { raw, db } = setup();
    await expect(
      mergePhotos(db, { into: 1, from: 1, visibility: "public", show: true }),
    ).rejects.toThrow(MergeError);
    await expect(
      mergePhotos(db, { into: 1, from: 9, visibility: "public", show: true }),
    ).rejects.toThrow(MergeError);
    raw.exec(
      "INSERT INTO camera_image (camera_id, media_id, position) VALUES (1, 2, 0)",
    );
    await expect(
      mergePhotos(db, { into: 1, from: 2, visibility: "public", show: true }),
    ).rejects.toThrow(/カメラの写真/);
    raw.exec("DELETE FROM camera_image");
    raw.exec(
      `INSERT INTO media_file (media_id, role, object_key, status) VALUES (2, 'edit', '/x/up.jpg', 'uploading')`,
    );
    await expect(
      mergePhotos(db, { into: 1, from: 2, visibility: "public", show: true }),
    ).rejects.toThrow(/未完了/);
  });

  it("refuses an undo while the photo it went into was merged on, and a path taken meanwhile is numbered", async () => {
    const { raw, db } = setup();
    await mergePhotos(db, {
      into: 1,
      from: 2,
      visibility: "public",
      show: true,
    });
    await mergePhotos(db, {
      into: 3,
      from: 1,
      visibility: "public",
      show: false,
    });
    await expect(unmergePhoto(db, "3456789234")).rejects.toThrow(/先にそちら/);
    await unmergePhoto(db, "2345678923");
    raw.exec(`UPDATE media SET path = '${B}' WHERE id = 3`);
    expect(await unmergePhoto(db, "3456789234")).toEqual({
      id: 2,
      path: `${DIR}/VRChat_2026-06-04_03-20-34.513_4320x7680_DxO-1.jpg`,
    });
  });

  it("never lets a photo take an alias's public id", async () => {
    const { raw, db } = setup();
    await mergePhotos(db, {
      into: 1,
      from: 2,
      visibility: "public",
      show: true,
    });
    expect(() =>
      raw.exec(
        `INSERT INTO media (file, platform, public_id) VALUES ('/n.png', 'Real', '3456789234')`,
      ),
    ).toThrow(/alias/);
    expect(() =>
      raw.exec(
        `INSERT INTO media_alias (public_id, media_id) VALUES ('2345678923', 1)`,
      ),
    ).toThrow(/public id/);
  });
});

describe("findSimilarPhoto", () => {
  it("finds the plainest photo an upload's name comes from, in its folder", async () => {
    const { db } = setup();
    const hint = {
      timestamp: "2026-06-04T03:20:37+09:00",
      creatorTool: "DxO PhotoLab 9.8.1",
    };
    expect(
      await findSimilarPhoto(
        db,
        `${DIR}/VRChat_2026-06-04_03-20-34.513_4320x7680_DxO-Edit.jpg`,
        99,
        hint,
      ),
    ).toMatchObject({
      id: 1,
      path: A,
      signals: { sameTime: true, tool: "DxO PhotoLab 9.8.1" },
    });
    // The same name (numbered on upload) is one too.
    expect(await findSimilarPhoto(db, A, 99, hint)).toMatchObject({ id: 1 });
    // Not itself, not another folder.
    expect(await findSimilarPhoto(db, A, 1, hint)).toBeNull();
    expect(await findSimilarPhoto(db, "/y/other_DxO.png", 99, hint)).toBeNull();
  });

  it("reads a range of the live paths per name", () => {
    const { raw } = setup();
    for (const l of similarLookups(`${DIR}/a_DxO.jpg`)) {
      const plan = (
        raw.prepare(`EXPLAIN QUERY PLAN ${l.sql}`).all(l.lo, l.hi, 1) as {
          detail: string;
        }[]
      )
        .map((r) => r.detail)
        .join("\n");
      expect(plan).toMatch(
        /SEARCH media USING INDEX idx_media_path_live \(path>\? AND path<\?\)/,
      );
    }
  });
});
