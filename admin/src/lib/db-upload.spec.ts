import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  completeUpload,
  deleteIncompleteUpload,
  initLookups,
  initUpload,
  listIncompleteUploads,
  NOT_COMPLETE,
  numberedPaths,
  numberedRange,
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
import { EMPTY_STORED, PHOTO_META_PARSER_DATE } from "./photo-meta";
import { displayKey } from "./upload";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
/** A display copy as the init announces it (of a 13,000 px original). */
const DISPLAY = {
  size: 4321,
  width: 8192,
  height: 126,
  sha256: "d".repeat(64),
};
/** Where row's display copy goes. */
const COPY = "/.derived/abcdefghjk-dddddddddddddddd.jpg";

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

  it("keeps what wrote the file on the original's file row", async () => {
    const { raw, db } = setup();
    await initUpload(
      db,
      init({
        meta: {
          exif: null,
          fileExif: { software: "ON1 Photo RAW 2026" },
          digitizedAt: null,
          location: null,
          world: null,
          photographer: null,
          vrcx: null,
        },
        hints: {
          creatorTool: null,
          xmpSummary: { crs: { ProcessVersion: "15.4" }, crs_count: 1 },
        },
        parserDate: PHOTO_META_PARSER_DATE,
      }),
      row,
    );
    await initUpload(
      db,
      init({ file: "/up/b.png", sha256: SHA_B, hints: { creatorTool: "LR" } }),
      id(1),
    );
    expect(
      raw
        .prepare(
          "SELECT object_key, creator_tool, xmp_summary FROM media_file WHERE role = 'original' AND object_key LIKE '/up/%' ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        object_key: "/up/a.png",
        creator_tool: "ON1 Photo RAW 2026",
        xmp_summary: '{"crs":{"ProcessVersion":"15.4"},"crs_count":1}',
      },
      { object_key: "/up/b.png", creator_tool: "LR", xmp_summary: null },
    ]);
  });

  it("stores the metadata read from the file, marked as read", async () => {
    const { raw, db } = setup();
    await initUpload(
      db,
      init({
        meta: {
          exif: { make: "FUJIFILM", f_number: 2.8 },
          fileExif: { make: "FUJIFILM", f_number: 2.8, software: "fw 1.0" },
          digitizedAt: null,
          location: { latitude: 35.6587, longitude: 139.7447 },
          world: { id: "wrld_x", name: "W" },
          photographer: { id: "usr_y", name: "Y" },
          vrcx: {
            instance_id: "wrld_x:1~region(jp)",
            players: [{ id: "usr_z", name: "Z" }],
          },
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
        meta: EMPTY_STORED,
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
        meta: EMPTY_STORED,
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
      "exif, latitude, longitude, location_source, world_id, world_name, photographer_id, photographer_name, vrcx, metadata_read_at IS NOT NULL AS read";
    expect(raw.prepare(`SELECT ${cols} FROM media WHERE id = 2`).get()).toEqual(
      {
        exif: '{"make":"FUJIFILM","f_number":2.8}',
        latitude: 35.6587,
        longitude: 139.7447,
        location_source: "exif",
        world_id: "wrld_x",
        world_name: "W",
        photographer_id: "usr_y",
        photographer_name: "Y",
        vrcx: '{"instance_id":"wrld_x:1~region(jp)","players":[{"id":"usr_z","name":"Z"}]}',
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
        photographer_id: null,
        photographer_name: null,
        vrcx: null,
        read: 1,
      },
    );
    expect(
      raw.prepare(`SELECT ${cols} FROM media WHERE id = 4`).get(),
    ).toMatchObject({ exif: null, read: 0 });
  });

  it("stores the pixel size as displayed, once the orientation is known", async () => {
    const { raw, db } = setup();
    const meta = (orientation?: number) => ({
      exif: null,
      fileExif: orientation === undefined ? null : { orientation },
      digitizedAt: null,
      location: null,
      world: null,
      photographer: null,
      vrcx: null,
    });
    const dimensions = { width: 4000, height: 3000 };
    // Upright.
    await initUpload(db, init({ dimensions, meta: meta() }), row);
    // Turned a quarter by its EXIF orientation: shown 3000 × 4000.
    await initUpload(
      db,
      init({ file: "/up/b.jpg", sha256: SHA_B, dimensions, meta: meta(6) }),
      id(1),
    );
    // The browser did not read the file: the orientation is unknown, so
    // the reader fills the size in later.
    await initUpload(
      db,
      init({ file: "/up/c.png", sha256: "c".repeat(64), dimensions }),
      id(2),
    );
    expect(
      raw.prepare("SELECT id, width, height FROM media WHERE id > 1").all(),
    ).toEqual([
      { id: 2, width: 4000, height: 3000 },
      { id: 3, width: 3000, height: 4000 },
      { id: 4, width: null, height: null },
    ]);
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

describe("initUpload lookups", () => {
  // The single query initUpload used before (an OR over sha256, file and
  // path, the names as json_each lists) and its decision: the new lookups
  // must decide the same for every case below.
  const OLD_SQL = `SELECT id, file, path, status, sha256, trashed_at FROM media
    WHERE sha256 = ?1 OR file IN (SELECT value FROM json_each(?2))
       OR (trashed_at IS NULL AND path IN (SELECT value FROM json_each(?2)))`;
  type Row = {
    id: number;
    file: string;
    path: string;
    status: string;
    sha256: string | null;
    trashed_at: string | null;
  };
  const oldDecision = (raw: DatabaseSync, file: string, sha256: string) => {
    const candidates = numberedPaths(file);
    const found = raw
      .prepare(OLD_SQL)
      .all(sha256, JSON.stringify(candidates)) as Row[];
    const same = found.find((r) => r.sha256 === sha256);
    if (same) {
      if (same.trashed_at !== null) return { trashed: same.path };
      if (same.status === "ready") return { exists: same.id };
      return { resume: same.id };
    }
    const taken = new Set(
      found.flatMap((r) =>
        r.trashed_at === null ? [r.file, r.path] : [r.file],
      ),
    );
    return { file: candidates.find((c) => !taken.has(c)) ?? null };
  };
  const newDecision = (o: Awaited<ReturnType<typeof initUpload>>) => {
    if (o.kind === "exists") return { exists: o.id };
    if (o.kind === "upload") {
      return o.resumed ? { resume: o.id } : { file: o.file };
    }
    const trashed = /ゴミ箱にあります \((.*)\)$/.exec(o.message);
    return trashed ? { trashed: trashed[1] } : { file: null };
  };

  // Names around /d/x.png: taken, numbered, look-alikes outside the
  // numbered range, moved in and out, trashed, still uploading.
  const sha = (n: number) => n.toString(16).padStart(64, "0");
  const seed = (): DatabaseSync => {
    const raw = migratedSqlite();
    const insert = raw.prepare(
      `INSERT INTO media (file, path, platform, status, sha256, trashed_at)
       VALUES (?, ?, 'Real', ?, ?, ?)`,
    );
    const rows: [string, string, string, string | null, string | null][] = [
      ["/d/x.png", "/d/x.png", "ready", sha(1), null],
      ["/d/x-1.png", "/d/x-1.png", "uploading", sha(2), null],
      // Its file is still /d/x-2.png; it is shown elsewhere.
      ["/d/x-2.png", "/e/moved.png", "ready", sha(3), null],
      // Shown at /d/x-3.png; its file is elsewhere.
      ["/e/x-3.png", "/d/x-3.png", "ready", null, null],
      // In the trash: the file is taken, the path is not.
      ["/d/x-4.png", "/d/x-4.png", "ready", sha(4), "2026-01-01"],
      ["/t/y.png", "/d/x-5.png", "ready", sha(5), "2026-01-01"],
      // Never a candidate.
      ["/d/x-6x.png", "/d/x-6x.png", "ready", null, null],
      ["/d/x-7.jpg", "/d/x-7.jpg", "ready", null, null],
      ["/d/x.jpg", "/d/x.jpg", "ready", null, null],
      ["/d/x-8/a.png", "/d/x-8/a.png", "ready", null, null],
      ["/d/x.d/x-9.png", "/d/x.d/x-9.png", "ready", null, null],
      ["/d/xx-10.png", "/d/xx-10.png", "ready", null, null],
      ["/d/noext", "/d/noext", "ready", null, null],
      ["/d/noext-1", "/d/noext-1", "ready", null, null],
    ];
    for (const r of rows) insert.run(...r);
    return raw;
  };
  const files = [
    "/d/x.png",
    "/d/x-1.png",
    "/d/x.jpg",
    "/d/x-7.png",
    "/d/xx.png",
    "/d/noext",
    "/e/moved.png",
    "/e/x.png",
    "/new/x.png",
  ];
  const hashes = [sha(1), sha(2), sha(3), sha(4), sha(5), "e".repeat(64)];

  for (const file of files) {
    for (const h of hashes) {
      it(`${file} ${h.slice(-1)}: same outcome as the old query`, async () => {
        const raw = seed();
        const expected = oldDecision(raw, file, h);
        const got = await initUpload(
          sqliteD1(raw),
          init({ file, sha256: h }),
          row,
        );
        expect(newDecision(got)).toEqual(expected);
      });
    }
  }

  it("skips every taken numbered name, up to the last one", async () => {
    const raw = migratedSqlite();
    const insert = raw.prepare(
      "INSERT INTO media (file, platform) VALUES (?, 'Real')",
    );
    for (const f of numberedPaths("/n/a.png").slice(0, -1)) insert.run(f);
    expect(
      await initUpload(sqliteD1(raw), init({ file: "/n/a.png" }), row),
    ).toMatchObject({ kind: "upload", file: "/n/a-50.png" });
  });

  it("never takes a camera picture's object (0019)", async () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO camera (id, slug, name) VALUES (1, 'c', 'C');
      INSERT INTO camera_image (camera_id, file) VALUES
        (1, '/n/a.png'), (1, '/n/a-1.png');`);
    expect(
      await initUpload(sqliteD1(raw), init({ file: "/n/a.png" }), row),
    ).toMatchObject({ kind: "upload", file: "/n/a-2.png" });
  });

  it("reads indexes, never all of media", () => {
    const raw = migratedSqlite();
    for (const { sql, args } of initLookups(SHA_A, "/d/x.png")) {
      const plan = (
        raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as {
          detail: string;
        }[]
      )
        .map((r) => r.detail)
        .join("\n");
      expect(plan).not.toMatch(/\bSCAN\b|json_each/);
      expect(plan).toMatch(
        /SEARCH (media|f|media_file|camera_image) USING (COVERING )?INDEX/,
      );
    }
  });

  it("finds a hash or a bucket key among every file of every photo", async () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO media (id, file, platform) VALUES (1, '/r/a.png', 'Real');
      INSERT INTO media_file (media_id, role, object_key, source_file_id, status, sha256) VALUES
        (1, 'edit', '/r/a_lightroom.jpg', 1, 'ready', '${SHA_B}'),
        (1, 'edit', '/r/x.png', 1, 'uploading', '${"c".repeat(64)}');`);
    const db = sqliteD1(raw);
    // A retouched version's bytes: that photo has them.
    expect(
      await initUpload(db, init({ file: "/up/y.jpg", sha256: SHA_B }), row),
    ).toEqual({ kind: "exists", id: 1, file: "/r/a.png" });
    expect(
      await initUpload(
        db,
        init({ file: "/up/y.jpg", sha256: "c".repeat(64) }),
        row,
      ),
    ).toMatchObject({ kind: "conflict", retry: false });
    // A retouched version's key is taken in the bucket.
    expect(await initUpload(db, init({ file: "/r/x.png" }), row)).toMatchObject(
      { kind: "upload", file: "/r/x-1.png" },
    );
    expect(
      raw
        .prepare(
          "SELECT role, object_key, status, sha256 FROM media_file WHERE object_key = '/r/x-1.png'",
        )
        .get(),
    ).toEqual({
      role: "original",
      object_key: "/r/x-1.png",
      status: "uploading",
      sha256: SHA_A,
    });
  });

  it("ranges over the numbered names only", () => {
    expect(numberedRange("/a.b/IMG_1.JPG")).toEqual([
      "/a.b/IMG_1-0",
      "/a.b/IMG_1-:",
    ]);
    for (const file of ["/a/x.png", "/a.b/noext", "/a/x-.png", "/a/x9.png"]) {
      const [lo, hi] = numberedRange(file);
      for (const p of numberedPaths(file).slice(1)) {
        expect(p >= lo && p < hi, p).toBe(true);
      }
    }
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
    // A multipart upload's id, while it uploads (media_file, 0013).
    raw.exec("UPDATE media_file SET upload_id = 'mp' WHERE media_id = 2");
    expect(await completeUpload(db, 2, UPLOADED)).toEqual({ kind: "ready" });
    const r = raw
      .prepare("SELECT status, uploaded_at FROM media WHERE id = 2")
      .get();
    expect(r?.status).toBe("ready");
    expect(r?.uploaded_at).toMatch(/^\d{4}-/);
    // Its original's file row with it, in the same statement.
    expect(
      raw
        .prepare(
          "SELECT role, status, upload_id, uploaded_at FROM media_file WHERE media_id = 2",
        )
        .get(),
    ).toEqual({
      role: "original",
      status: "ready",
      upload_id: null,
      uploaded_at: r?.uploaded_at,
    });
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

  it("bumps the API's content version for a photo a rule made visible", async () => {
    const { raw, db } = setup();
    const version = () =>
      (
        raw
          .prepare("SELECT value FROM setting WHERE key = 'content_version'")
          .get() as { value: string } | undefined
      )?.value;
    // Private: the API answers the same.
    await initUpload(db, init(), row);
    await completeUpload(db, 2, UPLOADED);
    expect(version()).toBeUndefined();
    // Unlisted by a rule: it opens by URL once ready.
    await initUpload(db, init({ file: "/up/b.png", sha256: SHA_B }), {
      ...id(1),
      visibility: "unlisted",
    });
    expect(version()).toBeUndefined();
    await completeUpload(
      db,
      3,
      bucket({ "/up/b.png": { size: 10, sha256: SHA_B } }),
    );
    expect(version()).toBeDefined();
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
    const removed: string[] = [];
    const remove = async (key: string) => void removed.push(key);
    expect(await deleteIncompleteUpload(db, 1, remove)).toBe(false);
    expect(await deleteIncompleteUpload(db, 2, remove)).toBe(true);
    expect(await listIncompleteUploads(db)).toEqual([]);
    // No display copy: nothing to remove from the bucket.
    expect(removed).toEqual([]);
  });

  it("take their display copy's object with them, once the row is gone", async () => {
    const { raw, db } = setup();
    await initUpload(db, init({ display: DISPLAY }), row);
    const removed: string[] = [];
    const remove = async (key: string) => {
      // The row is already gone: a completion now finds nothing.
      expect(await listIncompleteUploads(db)).toEqual([]);
      removed.push(key);
    };
    expect(await deleteIncompleteUpload(db, 2, remove)).toBe(true);
    expect(removed).toEqual([COPY]);
    expect(
      raw
        .prepare("SELECT COUNT(*) AS n FROM media_file WHERE media_id = 2")
        .get(),
    ).toEqual({ n: 0 });
    // A failed deletion is reported (the object is left over).
    await initUpload(
      db,
      init({ file: "/up/b.png", sha256: SHA_B, display: DISPLAY }),
      id(1),
    );
    await expect(
      deleteIncompleteUpload(db, 3, async () => {
        throw new Error("削除の権限がありません");
      }),
    ).rejects.toThrow("削除の権限がありません");
  });

  it("keep the photo uploading when the copy changes during the check", async () => {
    const { raw, db } = setup();
    await initUpload(db, init({ display: DISPLAY }), row);
    const again = { ...DISPLAY, size: 5555, sha256: "e".repeat(64) };
    const stat = async (file: string): Promise<ObjectStat | null> => {
      if (file !== COPY) return { size: 10, sha256: SHA_A };
      // A resume announces another encoding after this check read it.
      await initUpload(db, init({ display: again }), id(1));
      return { size: DISPLAY.size, sha256: DISPLAY.sha256 };
    };
    expect(await completeUpload(db, 2, stat)).toEqual({
      kind: "mismatch",
      message: NOT_COMPLETE,
    });
    expect(
      raw.prepare("SELECT status FROM media WHERE id = 2").get()?.status,
    ).toBe("uploading");
    expect(
      raw.prepare("SELECT status FROM media_file WHERE role = 'display'").get()
        ?.status,
    ).toBe("uploading");
  });

  it("are never deleted once ready, nor their copy", async () => {
    const { db } = setup();
    await initUpload(db, init({ display: DISPLAY }), row);
    await completeUpload(
      db,
      2,
      bucket({
        "/up/a.png": { size: 10, sha256: SHA_A },
        [COPY]: { size: DISPLAY.size, sha256: DISPLAY.sha256 },
      }),
    );
    const removed: string[] = [];
    expect(
      await deleteIncompleteUpload(db, 2, async (k) => void removed.push(k)),
    ).toBe(false);
    expect(removed).toEqual([]);
  });
});

describe("display copies (media_file role display)", () => {
  const copyRows = (raw: DatabaseSync) =>
    raw
      .prepare(
        `SELECT f.media_id, f.object_key, f.status, f.size, f.sha256, f.mime_type,
           s.role AS source_role
         FROM media_file f JOIN media_file s ON s.id = f.source_file_id
         WHERE f.role = 'display' ORDER BY f.id`,
      )
      .all();

  it("get a row made from the original only when the init has one", async () => {
    const { raw, db } = setup();
    expect(await initUpload(db, init({ display: DISPLAY }), row)).toEqual({
      kind: "upload",
      id: 2,
      file: "/up/a.png",
      resumed: false,
      display: COPY,
    });
    expect(
      await initUpload(db, init({ file: "/up/b.png", sha256: SHA_B }), id(1)),
    ).toEqual({ kind: "upload", id: 3, file: "/up/b.png", resumed: false });
    expect(copyRows(raw)).toEqual([
      {
        media_id: 2,
        object_key: COPY,
        status: "uploading",
        size: DISPLAY.size,
        sha256: DISPLAY.sha256,
        mime_type: "image/jpeg",
        source_role: "original",
      },
    ]);
    expect(COPY).toBe(displayKey(row.publicId, DISPLAY.sha256));
  });

  it("are written again on a resume, as that attempt announces them", async () => {
    const { raw, db } = setup();
    await initUpload(db, init({ display: DISPLAY }), row);
    const again = { ...DISPLAY, size: 5555, sha256: "e".repeat(64) };
    // Another encoding: a key of its own, in place of the earlier row (so
    // a late PUT of either never replaces the one that is checked).
    const againKey = "/.derived/abcdefghjk-eeeeeeeeeeeeeeee.jpg";
    expect(await initUpload(db, init({ display: again }), id(1))).toEqual({
      kind: "upload",
      id: 2,
      file: "/up/a.png",
      resumed: true,
      display: againKey,
    });
    expect(copyRows(raw)).toMatchObject([
      { object_key: againKey, size: 5555, sha256: again.sha256 },
    ]);
    // The same encoding again: the same row.
    expect(await initUpload(db, init({ display: again }), id(1))).toMatchObject(
      { display: againKey },
    );
    expect(copyRows(raw)).toHaveLength(1);
    // An earlier attempt without one gets one.
    await initUpload(db, init({ file: "/up/b.png", sha256: SHA_B }), id(2));
    expect(
      await initUpload(
        db,
        init({ file: "/up/b.png", sha256: SHA_B, display: DISPLAY }),
        id(3),
      ),
    ).toMatchObject({
      id: 3,
      resumed: true,
      display: "/.derived/ccccccccc3-dddddddddddddddd.jpg",
    });
  });

  it("are checked by the completion and made ready with the photo", async () => {
    const { raw, db } = setup();
    await initUpload(db, init({ display: DISPLAY }), row);
    const original = { "/up/a.png": { size: 10, sha256: SHA_A } };
    expect(await completeUpload(db, 2, bucket(original))).toEqual({
      kind: "mismatch",
      message: NOT_COMPLETE,
    });
    expect(
      await completeUpload(
        db,
        2,
        bucket({ ...original, [COPY]: { size: 4321, sha256: null } }),
      ),
    ).toEqual({
      kind: "mismatch",
      message: NOT_COMPLETE,
    });
    expect(copyRows(raw)).toMatchObject([{ status: "uploading" }]);
    expect(
      await completeUpload(
        db,
        2,
        bucket({ ...original, [COPY]: { size: 4321, sha256: DISPLAY.sha256 } }),
      ),
    ).toEqual({ kind: "ready" });
    expect(copyRows(raw)).toMatchObject([{ status: "ready" }]);
    expect(
      raw
        .prepare("SELECT uploaded_at FROM media_file WHERE role = 'display'")
        .get()?.uploaded_at,
    ).toMatch(/^\d{4}-/);
  });
});
