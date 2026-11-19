// A photo's devices on the real schema: the camera or scanner its file
// names, linked (and its camera row created) by uploads and the metadata
// reader (device.ts), and what updateMedia marks as chosen by hand.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backfillAndPublish,
  backfillBatch,
  PHOTO_META_PARSER_DATE,
  type ReadBytes,
} from "./backfill";
import { CONTENT_VERSION_KEY } from "./last-good";
import { digitizerOptions, listCameras, updateMedia } from "./db";
import { initUpload } from "./db-upload";
import { deviceIdSql, deviceOf, ensureDeviceStatement } from "./device";
import { readPhotoMeta } from "./photo-meta";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { validatePatch } from "./validate";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const NOW = Date.parse(PHOTO_META_PARSER_DATE) + 24 * 3600 * 1000;

/** A bucket where every file is `bytes`. */
const bucketOf =
  (files: Record<string, Uint8Array>): ReadBytes =>
  async (file, range) => {
    const all = files[file];
    if (!all) return null;
    const bytes =
      "suffix" in range
        ? all.subarray(Math.max(0, all.length - range.suffix))
        : all.subarray(range.offset, range.offset + range.length);
    return { bytes, size: all.length };
  };

const GCMC = JSON.stringify({
  make: "GCMC",
  model: "Scanner",
  taken_at_original: "2021-01-01T00:31:12",
});

type Raw = ReturnType<typeof migratedSqlite>;

const cameras = (raw: Raw) =>
  raw
    .prepare(
      "SELECT id, slug, name, manufacturer, model, kind FROM camera ORDER BY id",
    )
    .all();

const devices = (raw: Raw) =>
  raw
    .prepare("SELECT file, camera_id, digitized_with FROM media ORDER BY id")
    .all();

const patch = (body: unknown) => {
  const v = validatePatch(body);
  if (!v.ok) throw new Error(v.error);
  return v.patch;
};

describe("the metadata reader links the device, creating its row", () => {
  // Production after 0009: GCMC / Scanner files with file_exif, read by
  // the previous parser, no スキャン機材 and no camera row naming it.
  const production = () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (file, platform, timestamp, file_exif, digitized_at,
                metadata_source, metadata_read_at)
      VALUES ('/2024/a.jpg', 'Real', NULL, '${GCMC}', '2021-01-01T00:31:12+09:00', NULL,
              '2026-11-20T00:00:00.000Z'),
             ('/2025/2025-hakurei-sakura/b.jpg', 'Real', '2025-04-01T00:00:00+09:00', '${GCMC}',
              '2021-01-01T00:31:12+09:00', '{"taken_at":"manual"}', '2026-11-20T00:00:00.000Z'),
             ('/2024/c.jpg', 'Real', NULL, '${GCMC}', NULL, '{"digitized_with":"manual"}',
              '2026-11-20T00:00:00.000Z')`);
    return { raw, db: sqliteD1(raw) };
  };
  const scans = {
    "/2024/a.jpg": fixture("gcmc-scan.jpg"),
    "/2025/2025-hakurei-sakura/b.jpg": fixture("gcmc-scan.jpg"),
    "/2024/c.jpg": fixture("gcmc-scan.jpg"),
  };

  it("links photos a scanner wrote after the parser bump, with one new row", async () => {
    const { raw, db } = production();
    const res = await backfillBatch(db, bucketOf(scans), 12, NOW);
    expect(res).toMatchObject({ read: 3, failed: 0 });
    expect(cameras(raw)).toEqual([
      {
        id: 1,
        slug: "scanner",
        name: "Scanner",
        manufacturer: "GCMC",
        model: "Scanner",
        kind: "scanner",
      },
    ]);
    expect(devices(raw)).toEqual([
      { file: "/2024/a.jpg", camera_id: null, digitized_with: 1 },
      {
        file: "/2025/2025-hakurei-sakura/b.jpg",
        camera_id: null,
        digitized_with: 1,
      },
      // Cleared by hand: stays.
      { file: "/2024/c.jpg", camera_id: null, digitized_with: null },
    ]);
    // The taken-at set by hand is kept.
    expect(
      raw.prepare("SELECT timestamp FROM media WHERE id = 2").get(),
    ).toEqual({ timestamp: "2025-04-01T00:00:00+09:00" });
  });

  it("gives the public API a new content version when it links a device", async () => {
    const { raw, db } = production();
    const version = () =>
      raw
        .prepare("SELECT value FROM setting WHERE key = ?")
        .get(CONTENT_VERSION_KEY) as { value: string } | undefined;
    // Nothing waiting: no write, no new version.
    raw.exec("UPDATE media SET metadata_read_at = '2999-01-01T00:00:00.000Z'");
    await backfillAndPublish(db, bucketOf(scans), 12, NOW);
    expect(version()).toBeUndefined();

    raw.exec(
      "UPDATE media SET metadata_read_at = '2026-11-20T00:00:00.000Z', visibility = 'public'",
    );
    await backfillAndPublish(db, bucketOf(scans), 12, NOW);
    expect(devices(raw)[0]).toMatchObject({ digitized_with: 1 });
    expect(version()?.value).toMatch(/^"[0-9a-f]{24}"$/);
  });

  it("does not create a row only a photo cleared by hand names", async () => {
    const { raw, db } = production();
    raw.exec("DELETE FROM media WHERE id IN (1, 2)");
    await backfillBatch(db, bucketOf(scans), 12, NOW);
    expect(cameras(raw)).toEqual([]);
  });

  it("links a camera's photos to its row, never over one chosen by hand", async () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO camera (slug, name, manufacturer, model, kind)
                VALUES ('other', 'Other', 'X', 'Y', 'digital');
              INSERT INTO media (file, platform, camera_id, metadata_source)
                VALUES ('/a.jpg', 'Real', NULL, NULL),
                       ('/b.jpg', 'Real', NULL, NULL),
                       ('/c.jpg', 'Real', 1, NULL),
                       ('/d.jpg', 'Real', NULL, '{"camera":"manual"}'),
                       ('/e.jpg', 'VRChat', NULL, NULL)`);
    const db = sqliteD1(raw);
    const xt5 = fixture("exif-gps.jpg");
    await backfillBatch(
      db,
      bucketOf({
        "/a.jpg": xt5,
        "/b.jpg": xt5,
        "/c.jpg": xt5,
        "/d.jpg": xt5,
        "/e.jpg": xt5,
      }),
      12,
      NOW,
    );
    expect(cameras(raw)).toEqual([
      expect.objectContaining({ id: 1, slug: "other" }),
      {
        id: 2,
        slug: "x-t5",
        name: "X-T5",
        manufacturer: "FUJIFILM",
        model: "X-T5",
        kind: "digital",
      },
    ]);
    expect(devices(raw)).toEqual([
      { file: "/a.jpg", camera_id: 2, digitized_with: null },
      { file: "/b.jpg", camera_id: 2, digitized_with: null },
      { file: "/c.jpg", camera_id: 1, digitized_with: null },
      { file: "/d.jpg", camera_id: null, digitized_with: null },
      // VRChat: linked to the existing row (created for a and b).
      { file: "/e.jpg", camera_id: 2, digitized_with: null },
    ]);
  });

  it("takes the camera from a shooting EXIF corrected by hand", async () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (file, platform, exif, metadata_source)
      VALUES ('/a.jpg', 'Real', '{"make":"Canon","model":"Canon EOS R5"}',
              '{"exif":"manual"}')`);
    await backfillBatch(
      sqliteD1(raw),
      bucketOf({ "/a.jpg": fixture("exif-gps.jpg") }),
      12,
      NOW,
    );
    expect(cameras(raw)).toEqual([
      {
        id: 1,
        slug: "eos-r5",
        name: "EOS R5",
        manufacturer: "Canon",
        model: "EOS R5",
        kind: "digital",
      },
    ]);
    expect(devices(raw)).toEqual([
      { file: "/a.jpg", camera_id: 1, digitized_with: null },
    ]);
  });

  it("never creates a row for a VRChat photo", async () => {
    const raw = migratedSqlite();
    raw.exec("INSERT INTO media (file, platform) VALUES ('/e.jpg', 'VRChat')");
    await backfillBatch(
      sqliteD1(raw),
      bucketOf({ "/e.jpg": fixture("exif-gps.jpg") }),
      12,
      NOW,
    );
    expect(cameras(raw)).toEqual([]);
    expect(devices(raw)).toEqual([
      { file: "/e.jpg", camera_id: null, digitized_with: null },
    ]);
  });
});

describe("uploads link the device, creating its row once", () => {
  const meta = async (name: string) => {
    const { takenAt: _, dates: __, ...m } = await readPhotoMeta(fixture(name));
    return m;
  };
  const init = (file: string, sha: string, m: unknown) => ({
    file,
    size: 10,
    contentType: "image/jpeg",
    sha256: sha.repeat(64),
    timestamp: null,
    meta: m as never,
    parserDate: PHOTO_META_PARSER_DATE,
  });

  it("creates a scanner or camera row on the first upload and reuses it", async () => {
    const raw = migratedSqlite();
    const db = sqliteD1(raw);
    const scan = await meta("gcmc-scan.jpg");
    const xt5 = await meta("exif-gps.jpg");
    const row = (n: number, platform: "Real" | "VRChat" = "Real") => ({
      publicId: `${"c".repeat(9)}${n + 2}`,
      platform,
    });
    await initUpload(db, init("/u/s1.jpg", "a", scan), row(1));
    await initUpload(db, init("/u/s2.jpg", "b", scan), row(2));
    await initUpload(db, init("/u/c1.jpg", "c", xt5), row(3));
    await initUpload(db, init("/u/c2.jpg", "d", xt5), row(4));
    expect(
      cameras(raw).map((c) => (c as { slug: string; kind: string }).kind),
    ).toEqual(["scanner", "digital"]);
    expect(devices(raw)).toEqual([
      { file: "/u/s1.jpg", camera_id: null, digitized_with: 1 },
      { file: "/u/s2.jpg", camera_id: null, digitized_with: 1 },
      { file: "/u/c1.jpg", camera_id: 2, digitized_with: null },
      { file: "/u/c2.jpg", camera_id: 2, digitized_with: null },
    ]);
  });

  it("does not create a camera for a VRChat upload", async () => {
    const raw = migratedSqlite();
    const db = sqliteD1(raw);
    const xt5 = await meta("exif-gps.jpg");
    await initUpload(db, init("/v/a.jpg", "a", xt5), {
      publicId: "cccccccccc",
      platform: "VRChat",
    });
    expect(cameras(raw)).toEqual([]);
    expect(devices(raw)).toEqual([
      { file: "/v/a.jpg", camera_id: null, digitized_with: null },
    ]);
  });
});

describe("ensureDeviceStatement", () => {
  const scanner = deviceOf(
    { fileExif: { make: "GCMC", model: "Scanner" } },
    "Real",
  )!;

  it("takes the next free slug, and runs twice harmlessly", async () => {
    const raw = migratedSqlite();
    raw.exec(
      "INSERT INTO camera (slug, name) VALUES ('scanner', 'Other'), ('scanner-2', 'Other 2')",
    );
    const db = sqliteD1(raw);
    // Two requests at once: D1 runs them one after the other.
    await db.batch([
      ensureDeviceStatement(db, scanner),
      ensureDeviceStatement(db, scanner),
    ]);
    await ensureDeviceStatement(db, {
      ...scanner,
      rawMake: "gcmc",
      rawModel: "SCANNER",
    }).run();
    expect(cameras(raw).map((c) => (c as { slug: string }).slug)).toEqual([
      "scanner",
      "scanner-2",
      "scanner-3",
    ]);
  });

  it("finds a row by either spelling", () => {
    const raw = migratedSqlite();
    raw.exec(
      "INSERT INTO camera (slug, name, manufacturer, model) VALUES ('r5', 'R5', 'Canon', 'Canon EOS R5')",
    );
    const sql = `SELECT ${deviceIdSql("?1", "?2", "?3", "?4")} AS id`;
    expect(
      raw.prepare(sql).get("CANON", "Canon", "Canon EOS R5", "EOS R5"),
    ).toEqual({ id: 1 });
    expect(raw.prepare(sql).get("Nikon", "Nikon", "Z 6", "Z 6")).toEqual({
      id: null,
    });
  });
});

describe("updateMedia: taken-at, devices, EXIF", () => {
  const setup = () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (file, platform, timestamp, file_exif, digitized_at, metadata_source)
      VALUES ('/2024/a.jpg', 'Real', NULL, '${GCMC}', '2021-01-01T00:31:12+09:00', NULL),
             ('/x.jpg', 'Real', '2023-12-11T01:21:32+09:00',
               '{"make":"FUJIFILM","model":"X-T5"}', NULL, NULL)`);
    return { raw, db: sqliteD1(raw) };
  };

  it("sets the taken-at by hand, as manual, and only when it changes", async () => {
    const { db } = setup();
    const row = await updateMedia(
      db,
      1,
      patch({ timestamp: "2024-02-01T00:00:00+09:00" }),
    );
    expect(row).toMatchObject({
      timestamp: "2024-02-01T00:00:00+09:00",
      metadata_source: { taken_at: "manual" },
    });
    // The same value again: no new mark on another photo.
    const same = await updateMedia(
      db,
      2,
      patch({ timestamp: "2023-12-11T01:21:32+09:00" }),
    );
    expect(same?.metadata_source).toEqual({});
    expect(validatePatch({ timestamp: "2024-02-30T00:00:00+09:00" }).ok).toBe(
      false,
    );
    expect(validatePatch({ timestamp: "2024-02-01T00:00" }).ok).toBe(false);
  });

  it("sets or clears the スキャン機材 and the camera as manual, and the EXIF choice", async () => {
    const { raw, db } = setup();
    raw.exec(
      "INSERT INTO camera (slug, name, kind) VALUES ('ls-50', 'LS-50', 'scanner')",
    );
    const set = await updateMedia(
      db,
      1,
      patch({ digitized_with: 1, embed_exif: false }),
    );
    expect(set).toMatchObject({
      digitized_with: 1,
      embed_exif: false,
      metadata_source: { digitized_with: "manual" },
    });
    const cleared = await updateMedia(
      db,
      1,
      patch({ digitized_with: null, embed_exif: null }),
    );
    expect(cleared).toMatchObject({ digitized_with: null, embed_exif: null });
    // A camera echoed unchanged is no choice; a changed one is.
    expect(
      (await updateMedia(db, 2, patch({ camera_id: null })))?.metadata_source,
    ).toEqual({});
    expect(
      (await updateMedia(db, 2, patch({ camera_id: 1 })))?.metadata_source,
    ).toEqual({ camera: "manual" });
    expect(validatePatch({ embed_exif: "yes" }).ok).toBe(false);
    expect(validatePatch({ digitized_with: 0 }).ok).toBe(false);
  });

  it("counts each device's scans apart", async () => {
    const { raw, db } = setup();
    raw.exec(`INSERT INTO camera (slug, name, kind) VALUES ('s', 'S', 'scanner');
              UPDATE media SET digitized_with = 1 WHERE id = 1`);
    const cams = await listCameras(db);
    expect(cams.map((c) => [c.slug, c.digitized_count])).toEqual([["s", 1]]);
  });
});

describe("digitizerOptions", () => {
  it("lists scanners first", () => {
    expect(
      digitizerOptions([
        { id: 1, name: "A", slug: "a", kind: "digital" },
        { id: 2, name: "B", slug: "b", kind: "scanner" },
        { id: 3, name: "C", slug: "c", kind: null },
      ]).map((c) => c.id),
    ).toEqual([2, 1, 3]);
  });
});
