import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  backfillBatch,
  CLAIM_STALE_MS,
  FAILED_RETRY_MS,
  unreadArgs,
  WAITING_SQL,
  countUnread,
  PHOTO_META_PARSER_DATE,
  type ReadBytes,
} from "./backfill";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** A fixed "now", after the parser date. */
const NOW = Date.parse(PHOTO_META_PARSER_DATE) + 24 * 3600 * 1000;

/** A bucket of whole files, read by range like AdminImage.bytes. */
const bucket = (files: Record<string, Uint8Array>) => {
  const calls: string[] = [];
  const read: ReadBytes = async (file, range) => {
    calls.push(`${file} ${JSON.stringify(range)}`);
    const all = files[file];
    if (!all) return null;
    const bytes =
      "suffix" in range
        ? all.subarray(Math.max(0, all.length - range.suffix))
        : all.subarray(range.offset, range.offset + range.length);
    return { bytes, size: all.length };
  };
  return { read, calls };
};

const VRCHAT = "/v/VRChat_2026-11-02_11-31-36.000_8x8.png";

const setup = () => {
  const raw = migratedSqlite();
  const insert = raw.prepare(
    "INSERT INTO media (file, platform, timestamp) VALUES (?, 'Real', ?)",
  );
  insert.run("/a/exif.jpg", null);
  insert.run("/a/world.png", "2026-01-01T00:00:00+09:00");
  insert.run("/a/missing.png", null);
  insert.run("/a/broken.jpg", null);
  return { raw, db: sqliteD1(raw) };
};

type Raw = ReturnType<typeof migratedSqlite>;

const columns = (raw: Raw, id: number) =>
  raw
    .prepare(
      `SELECT exif, latitude, longitude, location_source, world_id, world_name,
              world_author_id, timestamp, metadata_source, metadata_read_at
       FROM media WHERE id = ?`,
    )
    .get(id) as Record<string, unknown>;

const isRead = (raw: Raw, id: number) =>
  /^\d{4}-/.test(String(columns(raw, id).metadata_read_at));

describe("backfillBatch", () => {
  const files = {
    "/a/exif.jpg": fixture("exif-gps.jpg"),
    "/a/world.png": fixture("vrchat-xmp.png"),
  };

  it("reads each photo, records the sources, and keeps failures claimed", async () => {
    const { raw, db } = setup();
    const { read: inner } = bucket(files);
    const read: ReadBytes = (file, range) =>
      file === "/a/broken.jpg"
        ? Promise.reject(new Error("502"))
        : inner(file, range);
    expect(await countUnread(db, NOW)).toBe(4);
    expect(await backfillBatch(db, read, 10, NOW)).toEqual({
      read: 4,
      found: 2,
      failed: 1,
      more: false,
    });
    expect(columns(raw, 1)).toMatchObject({
      latitude: expect.closeTo(35.6587, 4),
      location_source: "exif",
      timestamp: "2023-12-11T01:21:32+09:00",
    });
    expect(JSON.parse(String(columns(raw, 1).metadata_source))).toEqual({
      taken_at: "exif",
      exif: "file",
    });
    expect(columns(raw, 2)).toMatchObject({
      world_id: "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
      world_author_id: "usr_00000000-1111-2222-3333-444444444444",
      // Nothing in the file says when: kept.
      timestamp: "2026-01-01T00:00:00+09:00",
    });
    // Missing from the bucket: read, nothing found.
    expect(isRead(raw, 3)).toBe(true);
    expect(columns(raw, 3).exif).toBeNull();
    // Failed: tried again a day later, not on every page view.
    expect(String(columns(raw, 4).metadata_read_at)).toMatch(/^failed:.*!new$/);
    expect(await countUnread(db, NOW)).toBe(0);
    expect(await countUnread(db, NOW + CLAIM_STALE_MS + 1)).toBe(0);
    expect(await countUnread(db, NOW + FAILED_RETRY_MS + 1)).toBe(1);
  });

  it("takes over a claim left behind, keeping its first-read mark", async () => {
    const { raw, db } = setup();
    raw.exec("DELETE FROM media WHERE id <> 1");
    raw.exec(
      `UPDATE media SET metadata_read_at = 'reading:${new Date(NOW - CLAIM_STALE_MS - 1).toISOString()}!new'`,
    );
    expect(await countUnread(db, NOW)).toBe(1);
    await backfillBatch(db, bucket(files).read, 10, NOW);
    // First read: the empty location is filled.
    expect(columns(raw, 1)).toMatchObject({ location_source: "exif" });
  });

  it("does not bring back a location cleared before sources were kept", async () => {
    const { raw, db } = setup();
    raw.exec("DELETE FROM media WHERE id <> 1");
    // Read once, then cleared by hand (before 0008: no mark at all).
    raw.exec("UPDATE media SET metadata_read_at = '2026-01-01T00:00:00.000Z'");
    await backfillBatch(db, bucket(files).read, 10, NOW);
    expect(columns(raw, 1)).toMatchObject({
      latitude: null,
      location_source: null,
      // The rest is read as usual.
      timestamp: "2023-12-11T01:21:32+09:00",
    });
  });

  it("does not overwrite an edit made while the photo was being read", async () => {
    const { raw, db } = setup();
    raw.exec("DELETE FROM media WHERE id <> 1");
    const read: ReadBytes = async (file, range) => {
      // The owner saves the edit page meanwhile.
      raw.exec(
        `UPDATE media SET exif = '{"make":"Mine"}',
           metadata_source = '{"exif":"manual"}',
           updated_at = '2099-01-01T00:00:00.000Z'`,
      );
      return bucket(files).read(file, range);
    };
    expect(await backfillBatch(db, read, 10, NOW)).toMatchObject({
      failed: 1,
    });
    expect(columns(raw, 1)).toMatchObject({ exif: '{"make":"Mine"}' });
  });

  it("never replaces a value entered by hand", async () => {
    const { raw, db } = setup();
    raw.exec(
      `UPDATE media SET latitude = 1, longitude = 2, location_source = 'manual',
         exif = '{"make":"Mine"}', metadata_source = '{"exif":"manual"}'
       WHERE id = 1;
       UPDATE media SET world_id = 'wrld_mine', world_name = NULL,
         metadata_source = '{"world":"manual"}' WHERE id = 2`,
    );
    await backfillBatch(db, bucket(files).read, 10, NOW);
    expect(columns(raw, 1)).toMatchObject({
      exif: '{"make":"Mine"}',
      latitude: 1,
      longitude: 2,
      location_source: "manual",
    });
    expect(columns(raw, 2)).toMatchObject({
      world_id: "wrld_mine",
      world_name: null,
      world_author_id: null,
    });
  });

  it("reads again after a parser update: filename → XMP, manual kept", async () => {
    const raw = migratedSqlite();
    const db = sqliteD1(raw);
    const old = "2026-01-01T00:00:00.000Z";
    raw
      .prepare(
        `INSERT INTO media (file, platform, timestamp, metadata_source, metadata_read_at)
         VALUES (?, 'VRChat', ?, ?, ?)`,
      )
      .run(
        VRCHAT,
        "2026-11-02T11:31:36.000+09:00",
        '{"taken_at":"filename"}',
        old,
      );
    raw
      .prepare(
        `INSERT INTO media (file, platform, timestamp, metadata_source, metadata_read_at)
         VALUES (?, 'VRChat', ?, ?, ?)`,
      )
      .run(
        "/v/b.png",
        "2020-01-01T00:00:00+09:00",
        '{"taken_at":"manual"}',
        old,
      );
    // Read after the parser date: not again.
    raw
      .prepare(
        `INSERT INTO media (file, platform, timestamp, metadata_read_at)
         VALUES ('/v/c.png', 'VRChat', NULL, ?)`,
      )
      .run(PHOTO_META_PARSER_DATE);
    const png = fixture("vrchat-2026.png");
    const { read, calls } = bucket({ [VRCHAT]: png, "/v/b.png": png });
    expect(await countUnread(db, NOW)).toBe(2);
    await backfillBatch(db, read, 10, NOW);
    expect(columns(raw, 1)).toMatchObject({
      timestamp: "2026-11-02T11:31:36.959+09:00",
      world_name: "桜の川 （Sakura）",
    });
    expect(JSON.parse(String(columns(raw, 1).metadata_source))).toEqual({
      taken_at: "xmp",
      world: "file",
    });
    expect(columns(raw, 2)).toMatchObject({
      timestamp: "2020-01-01T00:00:00+09:00",
    });
    expect(JSON.parse(String(columns(raw, 2).metadata_source))).toMatchObject({
      taken_at: "manual",
    });
    expect(calls.some((c) => c.startsWith("/v/c.png"))).toBe(false);
  });

  it("gives two tabs different photos", async () => {
    const { db } = setup();
    const a = bucket(files);
    const b = bucket(files);
    const [ra, rb] = await Promise.all([
      backfillBatch(db, a.read, 2, NOW),
      backfillBatch(db, b.read, 2, NOW),
    ]);
    const files1 = new Set(a.calls.map((c) => c.split(" ")[0]));
    const files2 = new Set(b.calls.map((c) => c.split(" ")[0]));
    expect([...files1].filter((f) => files2.has(f))).toEqual([]);
    expect(ra.read + rb.read).toBe(4);
  });

  it("stops with the reason when nothing can be read", async () => {
    const { db } = setup();
    const denied: ReadBytes = () =>
      Promise.reject(new Error("AdminImage.bytes: 403"));
    await expect(backfillBatch(db, denied, 10, NOW)).rejects.toThrow(/403/);
    // An outage, not the photos: tried again once the claims expire.
    expect(await countUnread(db, NOW)).toBe(0);
    expect(await countUnread(db, NOW + CLAIM_STALE_MS + 1)).toBe(4);
  });

  it("puts off a lone photo that cannot be read", async () => {
    const { raw, db } = setup();
    raw.exec("DELETE FROM media WHERE id <> 4");
    const denied: ReadBytes = () => Promise.reject(new Error("broken"));
    await expect(backfillBatch(db, denied, 10, NOW)).rejects.toThrow(/broken/);
    expect(await countUnread(db, NOW + CLAIM_STALE_MS + 1)).toBe(0);
    expect(await countUnread(db, NOW + FAILED_RETRY_MS + 1)).toBe(1);
  });

  it("reads a reset field again; only a location reset opens the location", async () => {
    const raw = migratedSqlite();
    const db = sqliteD1(raw);
    // Read before, location cleared by hand before 0008 (no mark).
    raw.exec(`INSERT INTO media (file, platform, metadata_read_at, exif, metadata_source)
      VALUES ('/a/exif.jpg', 'Real', '2100-01-01T00:00:00.000Z', '{"make":"Mine"}', '{"exif":"manual"}')`);
    const { updateMedia } = await import("./db");
    await updateMedia(db, 1, { reset_from_file: ["exif"] });
    await backfillBatch(db, bucket(files).read, 10, NOW);
    expect(columns(raw, 1)).toMatchObject({ latitude: null });
    expect(JSON.parse(String(columns(raw, 1).exif))).toMatchObject({
      make: "FUJIFILM",
    });
    await updateMedia(db, 1, { reset_from_file: ["location"] });
    await backfillBatch(db, bucket(files).read, 10, NOW);
    expect(columns(raw, 1)).toMatchObject({ location_source: "exif" });
  });

  it("writes the rows the schema takes when one is refused", async () => {
    const { raw, db } = setup();
    raw.exec(`CREATE TRIGGER refuse BEFORE UPDATE OF exif ON media
      WHEN NEW.id = 1 BEGIN SELECT RAISE(ABORT, 'refused'); END`);
    expect(await backfillBatch(db, bucket(files).read, 10, NOW)).toMatchObject({
      read: 4,
      failed: 1,
    });
    expect(isRead(raw, 1)).toBe(false);
    expect(isRead(raw, 2)).toBe(true);
  });

  it("finds the photos to read through the metadata_read_at index", () => {
    const { raw } = setup();
    const plan = (
      raw
        .prepare(
          `EXPLAIN QUERY PLAN SELECT id FROM media WHERE ${WAITING_SQL} LIMIT 12`,
        )
        .all(...unreadArgs(NOW)) as { detail: string }[]
    ).map((p) => p.detail);
    // Every term through the index: no table scan, no status index.
    expect(plan.join("\n")).toMatch(/idx_media_metadata_read_at/);
    expect(plan.join("\n")).not.toMatch(/SCAN media|idx_media_status/);
  });

  it("leaves trashed photos out", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET trashed_at = '2026-01-01' WHERE id = 1");
    expect(await countUnread(db, NOW)).toBe(3);
  });

  it("goes through in batches until nothing is left, and is idempotent", async () => {
    const { db } = setup();
    const b = bucket(files);
    expect(await backfillBatch(db, b.read, 2, NOW)).toMatchObject({
      read: 2,
      more: true,
    });
    expect(await backfillBatch(db, b.read, 2, NOW)).toMatchObject({
      read: 2,
      more: true,
    });
    expect(await backfillBatch(db, b.read, 2, NOW)).toMatchObject({
      read: 0,
      more: false,
    });
    const before = b.calls.length;
    expect(await backfillBatch(db, b.read, 10, NOW)).toMatchObject({
      read: 0,
    });
    expect(b.calls.length).toBe(before);
  });

  it("reads the end of a large PNG only when its start has no XMP", async () => {
    const big = new Uint8Array(300 * 1024);
    big.set(fixture("vrchat-xmp.png").subarray(0, 33)); // signature + IHDR
    // An IDAT chunk header saying it runs past the head.
    new DataView(big.buffer).setUint32(33, 200 * 1024);
    big.set([0x49, 0x44, 0x41, 0x54], 37);
    const { raw, db } = setup();
    raw.exec("DELETE FROM media WHERE id <> 2");
    const spy = vi.fn(bucket({ "/a/world.png": big }).read);
    await backfillBatch(db, spy, 10, NOW);
    expect(spy.mock.calls.map(([, r]) => r)).toEqual([
      { offset: 0, length: 128 * 1024 },
      { suffix: 64 * 1024 },
    ]);
  });
});
