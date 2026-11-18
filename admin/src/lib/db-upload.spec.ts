import { describe, expect, it } from "vitest";
import {
  completeUpload,
  deleteIncompleteUpload,
  initUpload,
  listIncompleteUploads,
  numberedPaths,
  sizeMismatch,
  type ObjectStat,
} from "./db-upload";

describe("sizeMismatch", () => {
  it("is in decimal units, or grouped bytes when they would read the same", () => {
    expect(sizeMismatch(12_300_000, 40_100_000)).toBe(
      "B2 は 12.3 MB（11.8 MiB）、予定は 40.1 MB（38.3 MiB）",
    );
    expect(sizeMismatch(12_300_001, 12_300_050)).toBe(
      "B2 は 12,300,001 バイト、予定は 12,300,050 バイト",
    );
  });
});
import { listMedia } from "./db";
import { PHOTO_META_PARSER_DATE } from "./photo-meta";
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
const row = { publicId: "abcdefghjk", platform: "Real" as const };
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
    "INSERT INTO media (file, platform, visibility) VALUES ('/old/x.png', 'Real', 'public')",
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
          "SELECT public_id, file, platform, timestamp, tags, visibility, status, size, sha256, uploaded_at FROM media WHERE id = 2",
        )
        .get(),
    ).toEqual({
      public_id: "abcdefghjk",
      file: "/up/a.png",
      platform: "Real",
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

  it("stores the metadata read from the file, marked as read", async () => {
    const { raw, db } = setup();
    await initUpload(
      db,
      init({
        meta: {
          exif: { make: "FUJIFILM", f_number: 2.8 },
          location: { latitude: 35.6587, longitude: 139.7447 },
          world: { id: "wrld_x", name: "W", authorId: "usr_y" },
        },
        timestampSource: "exif",
        parserDate: PHOTO_META_PARSER_DATE,
      }),
      row,
    );
    await initUpload(
      db,
      init({
        file: "/up/b.png",
        sha256: SHA_B,
        meta: { exif: null, location: null, world: null },
        parserDate: PHOTO_META_PARSER_DATE,
      }),
      id(1),
    );
    // No meta: the browser did not read it (an old tab).
    await initUpload(
      db,
      init({ file: "/up/c.png", sha256: "c".repeat(64) }),
      id(2),
    );
    // Read, but by an older parser: the reader reads it again.
    await initUpload(
      db,
      init({
        file: "/up/d.png",
        sha256: "d".repeat(64),
        meta: { exif: null, location: null, world: null },
        parserDate: "2000-01-01T00:00:00.000Z",
      }),
      id(3),
    );
    expect(
      raw.prepare("SELECT metadata_source FROM media WHERE id = 2").get(),
    ).toEqual({
      metadata_source: '{"taken_at":"exif","exif":"file","world":"file"}',
    });
    expect(
      raw.prepare("SELECT metadata_read_at FROM media WHERE id = 5").get(),
    ).toEqual({ metadata_read_at: null });
    const cols =
      "exif, latitude, longitude, location_source, world_id, world_name, world_author_id, metadata_read_at IS NOT NULL AS read";
    expect(raw.prepare(`SELECT ${cols} FROM media WHERE id = 2`).get()).toEqual(
      {
        exif: '{"make":"FUJIFILM","f_number":2.8}',
        latitude: 35.6587,
        longitude: 139.7447,
        location_source: "exif",
        world_id: "wrld_x",
        world_name: "W",
        world_author_id: "usr_y",
        read: 1,
      },
    );
    // Nothing found is still read.
    expect(raw.prepare(`SELECT ${cols} FROM media WHERE id = 3`).get()).toEqual(
      {
        exif: null,
        latitude: null,
        longitude: null,
        location_source: null,
        world_id: null,
        world_name: null,
        world_author_id: null,
        read: 1,
      },
    );
    expect(
      raw.prepare(`SELECT ${cols} FROM media WHERE id = 4`).get(),
    ).toMatchObject({ exif: null, read: 0 });
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

  it("counts a photo moved to the path, and the file of one moved away", async () => {
    const { raw, db } = setup();
    // /old/x.png's file stays; it is shown at /show/x.png now.
    raw.exec("UPDATE media SET path = '/show/x.png' WHERE file = '/old/x.png'");
    expect(
      await initUpload(db, init({ file: "/show/x.png", sha256: SHA_B }), row),
    ).toMatchObject({ file: "/show/x-1.png" });
    expect(
      await initUpload(db, init({ file: "/old/x.png" }), id(1)),
    ).toMatchObject({ file: "/old/x-1.png" });
  });

  it("refuses a photo that is in the trash", async () => {
    const { raw, db } = setup();
    await initUpload(db, init(), row);
    await completeUpload(db, 2, UPLOADED);
    raw.exec("UPDATE media SET trashed_at = '2026-01-01' WHERE id = 2");
    expect(await initUpload(db, init({ file: "/b/a.png" }), id(1))).toEqual({
      kind: "conflict",
      message: "同じ写真がゴミ箱にあります (/up/a.png)",
      retry: false,
    });
  });

  it("gives up when every numbered name is taken", async () => {
    const { raw, db } = setup();
    const insert = raw.prepare(
      "INSERT INTO media (file, platform) VALUES (?, 'Real')",
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
    ).toEqual({
      kind: "mismatch",
      message: "大きさが違います：B2 は 11 バイト、予定は 10 バイトです。",
    });
    expect(
      await completeUpload(
        db,
        2,
        bucket({ "/up/a.png": { size: 10, sha256: null } }),
      ),
    ).toEqual({
      kind: "mismatch",
      message: "中身が違います (SHA-256 が一致しません)",
    });
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
