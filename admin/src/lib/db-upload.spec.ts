import { describe, expect, it } from "vitest";
import {
  completeUpload,
  deleteIncompleteUpload,
  initUpload,
  listIncompleteUploads,
  numberedPaths,
  type ObjectStat,
} from "./db-upload";
import { listMedia } from "./db";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const init = (over: Partial<Parameters<typeof initUpload>[1]> = {}) => ({
  file: "/up/a.png",
  size: 10,
  contentType: "image/png",
  sha256: SHA_A,
  timestamp: "2026-11-18T01:02:03+09:00",
  ...over,
});
const row = { publicId: "abcdefghjk", world: "Real" as const };
/** Another valid public id (digits 2..9). */
const id = (n: number) => ({ ...row, publicId: `${"c".repeat(9)}${n + 1}` });

/** A bucket that has exactly `objects`. */
const bucket =
  (objects: Record<string, ObjectStat>) =>
  async (file: string): Promise<ObjectStat | null> =>
    objects[file] ?? null;
const UPLOADED = bucket({ "/up/a.png": { size: 10, sha256: SHA_A } });

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(
    "INSERT INTO media (file, world, visibility) VALUES ('/old/x.png', 'Real', 'public')",
  );
  return { raw, db: sqliteD1(raw) };
};

describe("initUpload", () => {
  it("reserves a private, uploading row with the upload's data", async () => {
    const { raw, db } = setup();
    expect(await initUpload(db, init(), row)).toEqual({
      kind: "upload",
      id: 2,
      file: "/up/a.png",
      resumed: false,
    });
    expect(
      raw
        .prepare(
          "SELECT public_id, file, world, timestamp, tags, visibility, status, size, sha256, uploaded_at FROM media WHERE id = 2",
        )
        .get(),
    ).toEqual({
      public_id: "abcdefghjk",
      file: "/up/a.png",
      world: "Real",
      timestamp: "2026-11-18T01:02:03+09:00",
      tags: "[]",
      visibility: "private",
      status: "uploading",
      size: 10,
      sha256: SHA_A,
      uploaded_at: null,
    });
    // Not a photo yet.
    expect((await listMedia(db, { limit: 10, offset: 0 })).total).toBe(1);
  });

  it("resumes the same photo, wherever its earlier attempt went", async () => {
    const { db } = setup();
    await initUpload(db, init(), row);
    expect(await initUpload(db, init(), id(1))).toEqual({
      kind: "upload",
      id: 2,
      file: "/up/a.png",
      resumed: true,
    });
    expect(await initUpload(db, init({ file: "/other/a.png" }), id(2))).toEqual(
      { kind: "upload", id: 2, file: "/up/a.png", resumed: true },
    );
  });

  it("reports a photo that is already uploaded, wherever it is", async () => {
    const { db } = setup();
    await initUpload(db, init(), row);
    await completeUpload(db, 2, UPLOADED);
    expect(await initUpload(db, init({ file: "/other/a.png" }), row)).toEqual({
      kind: "exists",
      id: 2,
      file: "/up/a.png",
    });
  });

  it("numbers the name when another photo has the path", async () => {
    const { db } = setup();
    expect(
      await initUpload(db, init({ file: "/old/x.png", sha256: SHA_B }), row),
    ).toMatchObject({ kind: "upload", file: "/old/x-1.png" });
    // Taken by an upload in progress too.
    expect(
      await initUpload(db, init({ file: "/old/x.png" }), id(1)),
    ).toMatchObject({ kind: "upload", file: "/old/x-2.png" });
  });

  it("gives up when every numbered name is taken", async () => {
    const { raw, db } = setup();
    const insert = raw.prepare(
      "INSERT INTO media (file, world) VALUES (?, 'Real')",
    );
    for (const f of numberedPaths("/n/a.png")) insert.run(f);
    expect(await initUpload(db, init({ file: "/n/a.png" }), row)).toEqual({
      kind: "conflict",
      message: "/n/a.png と同じ名前が多すぎます",
      retry: false,
    });
  });
});

describe("numberedPaths", () => {
  it("numbers before the extension", () => {
    const p = numberedPaths("/a.b/IMG_1.JPG");
    expect(p.slice(0, 3)).toEqual([
      "/a.b/IMG_1.JPG",
      "/a.b/IMG_1-1.JPG",
      "/a.b/IMG_1-2.JPG",
    ]);
    expect(p).toHaveLength(51);
  });
});

describe("completeUpload", () => {
  it("marks the row ready once the bucket has the file, and again is fine", async () => {
    const { raw, db } = setup();
    await initUpload(db, init(), row);
    expect(await completeUpload(db, 2, UPLOADED)).toEqual({ kind: "ready" });
    const r = raw
      .prepare("SELECT status, uploaded_at FROM media WHERE id = 2")
      .get();
    expect(r?.status).toBe("ready");
    expect(r?.uploaded_at).toMatch(/^\d{4}-/);
    // Already ready: the bucket is not asked again.
    expect(await completeUpload(db, 2, bucket({}))).toEqual({ kind: "ready" });
    expect(await completeUpload(db, 99, UPLOADED)).toEqual({
      kind: "not-found",
    });
    expect((await listMedia(db, { limit: 10, offset: 0 })).total).toBe(2);
  });

  it("refuses when the bucket has nothing or another file", async () => {
    const { raw, db } = setup();
    await initUpload(db, init(), row);
    expect(await completeUpload(db, 2, bucket({}))).toEqual({
      kind: "missing",
    });
    expect(
      await completeUpload(
        db,
        2,
        bucket({ "/up/a.png": { size: 11, sha256: SHA_A } }),
      ),
    ).toMatchObject({ kind: "mismatch" });
    expect(
      await completeUpload(
        db,
        2,
        bucket({ "/up/a.png": { size: 10, sha256: null } }),
      ),
    ).toEqual({ kind: "mismatch", message: "SHA-256 が違います" });
    expect(
      raw.prepare("SELECT status FROM media WHERE id = 2").get()?.status,
    ).toBe("uploading");
  });
});

describe("incomplete uploads", () => {
  it("are listed and can be deleted; ready photos cannot", async () => {
    const { db } = setup();
    await initUpload(db, init(), row);
    const list = await listIncompleteUploads(db);
    expect(list.map((u) => [u.id, u.file, u.size])).toEqual([
      [2, "/up/a.png", 10],
    ]);
    expect(await deleteIncompleteUpload(db, 1)).toBe(false);
    expect(await deleteIncompleteUpload(db, 2)).toBe(true);
    expect(await listIncompleteUploads(db)).toEqual([]);
  });
});
