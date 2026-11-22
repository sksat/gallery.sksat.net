import { describe, expect, it } from "vitest";
import {
  completeEditUpload,
  deleteIncompleteEdit,
  FileChangeError,
  initEditUpload,
  listIncompleteEdits,
  listPhotoFiles,
  listTrashedEdits,
  PHOTO_FILES_SQL,
  purgeEdits,
  restoreEdits,
  setShownFile,
  trashEdit,
} from "./db-retouch";
import { PHOTO_META_PARSER_DATE } from "./photo-meta";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import type { UploadInit } from "./upload";

const sha = (c: string) => c.repeat(64);

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform, public_id, sha256, size) VALUES
      (1, '/r/a.png', 'Real', '2345678923', '${sha("1")}', 100),
      (2, '/r/b.png', 'Real', '3456789234', '${sha("2")}', 200);
    INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status, size, sha256, creator_tool, xmp_summary, uploaded_at) VALUES
      (10, 1, 'edit', '/r/a_lightroom.jpg', NULL, 'ready', 50, '${sha("a")}',
       'Adobe Lightroom 8.2 (Windows)', '{"crs":{"Exposure2012":"+0.50"},"crs_count":40}', '2026-01-02T00:00:00.000Z'),
      (11, 1, 'display', '/.derived/2345678923-aaaa.jpg', 10, 'ready', 5, NULL, NULL, NULL, NULL);
  `);
  return { raw, db: sqliteD1(raw) };
};

const version = (raw: ReturnType<typeof migratedSqlite>) =>
  (
    raw
      .prepare("SELECT value FROM setting WHERE key = 'content_version'")
      .get() as { value: string } | undefined
  )?.value ?? null;

describe("listPhotoFiles", () => {
  it("lists the original, then the edits, with what to make their thumbnails from", async () => {
    const { db } = setup();
    const files = await listPhotoFiles(db, 1);
    expect(
      files.map((f) => [f.id, f.role, f.key, f.thumbKey, f.shown]),
    ).toEqual([
      [expect.any(Number), "original", "/r/a.png", "/r/a.png", true],
      [
        10,
        "edit",
        "/r/a_lightroom.jpg",
        "/.derived/2345678923-aaaa.jpg",
        false,
      ],
    ]);
    expect(files[1].creatorTool).toBe("Adobe Lightroom 8.2 (Windows)");
    expect(files[1].xmpSummary).toEqual({
      crs: { Exposure2012: "+0.50" },
      crs_count: 40,
    });
  });

  it("reads the photo's files by index", () => {
    const { raw } = setup();
    const plan = (
      raw.prepare(`EXPLAIN QUERY PLAN ${PHOTO_FILES_SQL}`).all(1) as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/\bSCAN\b/);
    expect(plan).toMatch(/idx_media_file_media/);
    expect(plan).toMatch(/idx_media_file_source/);
  });
});

describe("setShownFile", () => {
  it("shows an edit, bumps the content version, and goes back to the original as NULL", async () => {
    const { raw, db } = setup();
    const original = (await listPhotoFiles(db, 1))[0].id;
    expect(await setShownFile(db, 1, 10)).toEqual({ previous: original });
    const v1 = version(raw);
    expect(v1).not.toBeNull();
    expect(
      raw.prepare("SELECT active_file_id FROM media WHERE id = 1").get(),
    ).toEqual({
      active_file_id: 10,
    });
    expect((await listPhotoFiles(db, 1)).find((f) => f.shown)?.id).toBe(10);
    expect(await setShownFile(db, 1, original)).toEqual({ previous: 10 });
    expect(version(raw)).not.toBe(v1);
    expect(
      raw.prepare("SELECT active_file_id FROM media WHERE id = 1").get(),
    ).toEqual({
      active_file_id: null,
    });
  });

  it("refuses another photo's file, a copy and a removed edit", async () => {
    const { db } = setup();
    await expect(setShownFile(db, 2, 10)).rejects.toThrow(FileChangeError);
    await expect(setShownFile(db, 1, 11)).rejects.toThrow(FileChangeError);
    await trashEdit(db, 1, 10);
    await expect(setShownFile(db, 1, 10)).rejects.toThrow(FileChangeError);
  });
});

describe("removing an edit", () => {
  it("goes to the trash and comes back", async () => {
    const { db } = setup();
    expect(await trashEdit(db, 1, 10)).toBe(true);
    expect((await listPhotoFiles(db, 1)).map((f) => f.role)).toEqual([
      "original",
    ]);
    expect(
      (await listTrashedEdits(db)).map((e) => [
        e.id,
        e.mediaId,
        e.photoPath,
        e.thumbKey,
      ]),
    ).toEqual([[10, 1, "/r/a.png", "/.derived/2345678923-aaaa.jpg"]]);
    expect(await restoreEdits(db, [10])).toBe(1);
    expect((await listPhotoFiles(db, 1)).length).toBe(2);
    expect(await listTrashedEdits(db)).toEqual([]);
  });

  it("refuses the shown file and anything but an edit", async () => {
    const { raw, db } = setup();
    await setShownFile(db, 1, 10);
    await expect(trashEdit(db, 1, 10)).rejects.toThrow(FileChangeError);
    expect(() =>
      raw.exec(
        "UPDATE media_file SET trashed_at = 'x' WHERE role = 'original'",
      ),
    ).toThrow(/only an edit/);
    expect(await trashEdit(db, 2, 10)).toBe(false);
  });

  it("is deleted for good with its copies, objects first", async () => {
    const { raw, db } = setup();
    await trashEdit(db, 1, 10);
    const removed: string[] = [];
    expect(
      await purgeEdits(db, [10], async (o) => {
        removed.push(o.key);
      }),
    ).toEqual({ deleted: [10], failed: [] });
    expect(removed).toEqual([
      "/.derived/2345678923-aaaa.jpg",
      "/r/a_lightroom.jpg",
    ]);
    expect(
      raw
        .prepare("SELECT count(*) AS n FROM media_file WHERE media_id = 1")
        .get(),
    ).toEqual({ n: 1 });
  });

  it("keeps the rows when an object cannot be deleted, and never purges a live edit", async () => {
    const { raw, db } = setup();
    expect(await purgeEdits(db, [10], async () => {})).toEqual({
      deleted: [],
      failed: [],
    });
    await trashEdit(db, 1, 10);
    const r = await purgeEdits(db, [10], async () => {
      throw new Error("削除の権限がありません");
    });
    expect(r.failed).toEqual([{ id: 10, error: "削除の権限がありません" }]);
    expect(
      raw
        .prepare("SELECT count(*) AS n FROM media_file WHERE media_id = 1")
        .get(),
    ).toEqual({ n: 3 });
    // Nothing was deleted: it can still be put back.
    expect(await restoreEdits(db, [10])).toBe(1);
  });

  it("never puts back an edit some of whose objects are gone", async () => {
    const { db } = setup();
    await trashEdit(db, 1, 10);
    let calls = 0;
    await purgeEdits(db, [10], async () => {
      if (calls++ > 0) throw new Error("network");
    });
    expect(await restoreEdits(db, [10])).toBe(0);
    expect((await listTrashedEdits(db))[0].trashedAt).not.toMatch(/^purging:/);
    // A retry finishes it.
    expect((await purgeEdits(db, [10], async () => {})).deleted).toEqual([10]);
  });
});

const init = (over: Partial<UploadInit> = {}): UploadInit => ({
  file: "/r/a_DxO.jpg",
  size: 300,
  contentType: "image/jpeg",
  sha256: sha("d"),
  timestamp: "2026-06-04T04:50:27+09:00",
  meta: {
    exif: null,
    location: null,
    world: null,
    photographer: null,
    vrcx: null,
    fileExif: { software: "DxO PhotoLab 9.8.1" },
    digitizedAt: null,
  } as unknown as UploadInit["meta"],
  parserDate: PHOTO_META_PARSER_DATE,
  hints: { creatorTool: "DxO PhotoLab 9.8.1", xmpSummary: null },
  ...over,
});

describe("uploading an edit", () => {
  it("adds an uploading edit made from the original, ready once the bucket has it", async () => {
    const { raw, db } = setup();
    const out = await initEditUpload(db, 1, init());
    expect(out).toMatchObject({
      kind: "upload",
      file: "/r/a_DxO.jpg",
      resumed: false,
    });
    if (out.kind !== "upload") throw new Error();
    const row = raw
      .prepare(
        "SELECT role, status, source_file_id, creator_tool, file_exif, metadata_read_at FROM media_file WHERE id = ?",
      )
      .get(out.id) as Record<string, unknown>;
    expect(row.role).toBe("edit");
    expect(row.status).toBe("uploading");
    expect(row.source_file_id).toBe((await listPhotoFiles(db, 1))[0].id);
    expect(row.creator_tool).toBe("DxO PhotoLab 9.8.1");
    expect(JSON.parse(String(row.file_exif))).toEqual({
      software: "DxO PhotoLab 9.8.1",
    });
    expect(row.metadata_read_at).not.toBeNull();
    // Nothing of it becomes the photo's.
    expect(
      raw.prepare("SELECT timestamp, file_exif FROM media WHERE id = 1").get(),
    ).toEqual({
      timestamp: null,
      file_exif: null,
    });
    expect(await listIncompleteEdits(db, 1)).toEqual([
      { id: out.id, key: "/r/a_DxO.jpg", size: 300 },
    ]);
    // The same file again resumes it.
    expect(await initEditUpload(db, 1, init())).toMatchObject({
      kind: "upload",
      id: out.id,
      resumed: true,
    });

    expect(await completeEditUpload(db, 1, out.id, async () => null)).toEqual({
      kind: "missing",
    });
    expect(
      await completeEditUpload(db, 1, out.id, async () => ({
        size: 300,
        sha256: sha("e"),
      })),
    ).toMatchObject({ kind: "mismatch" });
    expect(
      await completeEditUpload(db, 1, out.id, async () => ({
        size: 300,
        sha256: sha("d"),
      })),
    ).toEqual({ kind: "ready" });
    expect((await listPhotoFiles(db, 1)).map((f) => f.key)).toEqual([
      "/r/a.png",
      "/r/a_lightroom.jpg",
      "/r/a_DxO.jpg",
    ]);
    expect(version(raw)).toBeNull();
    // Once there, the same bytes are the photo's already.
    expect(await initEditUpload(db, 1, init())).toEqual({
      kind: "exists",
      id: out.id,
      file: "/r/a_DxO.jpg",
    });
  });

  it("numbers a taken name and refuses bytes another file has", async () => {
    const { db } = setup();
    expect(
      await initEditUpload(db, 1, init({ file: "/r/b.png" })),
    ).toMatchObject({
      kind: "upload",
      file: "/r/b-1.png",
    });
    expect(
      await initEditUpload(db, 1, init({ sha256: sha("2") })),
    ).toMatchObject({
      kind: "conflict",
      message: "同じファイルが別の写真にあります (/r/b.png)",
    });
    expect(
      await initEditUpload(db, 1, init({ sha256: sha("1") })),
    ).toMatchObject({
      kind: "conflict",
    });
    expect(await initEditUpload(db, 9, init())).toMatchObject({
      kind: "conflict",
    });
  });

  it("puts a removed edit back when it is uploaded again", async () => {
    const { db } = setup();
    await trashEdit(db, 1, 10);
    expect(await initEditUpload(db, 1, init({ sha256: sha("a") }))).toEqual({
      kind: "exists",
      id: 10,
      file: "/r/a_lightroom.jpg",
    });
    expect(await listTrashedEdits(db)).toEqual([]);
  });

  it("makes a display copy row for an edit over the limits, ready with it", async () => {
    const { raw, db } = setup();
    const out = await initEditUpload(
      db,
      1,
      init({
        size: 200_000_000,
        display: { size: 9, width: 8192, height: 4608, sha256: sha("f") },
      }),
    );
    expect(out).toMatchObject({
      kind: "upload",
      display: `/.derived/2345678923-${"f".repeat(16)}.jpg`,
    });
    if (out.kind !== "upload") throw new Error();
    const stats: Record<string, { size: number; sha256: string }> = {
      "/r/a_DxO.jpg": { size: 200_000_000, sha256: sha("d") },
    };
    expect(
      await completeEditUpload(db, 1, out.id, async (f) => stats[f] ?? null),
    ).toMatchObject({
      kind: "mismatch",
    });
    stats[out.display ?? ""] = { size: 9, sha256: sha("f") };
    expect(
      await completeEditUpload(db, 1, out.id, async (f) => stats[f] ?? null),
    ).toEqual({ kind: "ready" });
    expect(
      raw
        .prepare(
          "SELECT status FROM media_file WHERE source_file_id = ? AND role = 'display'",
        )
        .get(out.id),
    ).toEqual({ status: "ready" });
    expect((await listPhotoFiles(db, 1)).at(-1)?.thumbKey).toBe(out.display);
  });

  it("forgets an incomplete one", async () => {
    const { db } = setup();
    const out = await initEditUpload(db, 1, init());
    if (out.kind !== "upload") throw new Error();
    expect(await deleteIncompleteEdit(db, 1, 10)).toBe(false);
    expect(await deleteIncompleteEdit(db, 1, out.id)).toBe(true);
    expect(await listIncompleteEdits(db, 1)).toEqual([]);
  });
});
