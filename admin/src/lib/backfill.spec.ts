import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { backfillBatch, countUnread, type ReadBytes } from "./backfill";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

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

const columns = (raw: ReturnType<typeof migratedSqlite>, id: number) =>
  raw
    .prepare(
      `SELECT exif, latitude, longitude, location_source, world_id, world_name,
              world_author_id, timestamp, metadata_read_at IS NOT NULL AS read
       FROM media WHERE id = ?`,
    )
    .get(id);

describe("backfillBatch", () => {
  const files = {
    "/a/exif.jpg": fixture("exif-gps.jpg"),
    "/a/world.png": fixture("vrchat-xmp.png"),
  };

  it("fills what is empty, marks each read, and skips failures", async () => {
    const { raw, db } = setup();
    const { read: inner } = bucket(files);
    const read: ReadBytes = (file, range) =>
      file === "/a/broken.jpg"
        ? Promise.reject(new Error("502"))
        : inner(file, range);
    expect(await countUnread(db)).toBe(4);
    expect(await backfillBatch(db, read, 0, 10)).toEqual({
      read: 4,
      found: 2,
      failed: 1,
      next: null,
    });
    expect(columns(raw, 1)).toMatchObject({
      latitude: expect.closeTo(35.6587, 4),
      location_source: "exif",
      world_id: null,
      // Filled from DateTimeOriginal: it was empty.
      timestamp: "2023-12-11T01:21:32+09:00",
      read: 1,
    });
    expect(
      JSON.parse(String((columns(raw, 1) as { exif: string }).exif)),
    ).toMatchObject({
      make: "FUJIFILM",
      model: "X-T5",
    });
    expect(columns(raw, 2)).toMatchObject({
      world_id: "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
      world_name: "The Black Cat & Friends",
      world_author_id: "usr_00000000-1111-2222-3333-444444444444",
      // Kept.
      timestamp: "2026-01-01T00:00:00+09:00",
    });
    // Missing from the bucket: nothing to read, marked read.
    expect(columns(raw, 3)).toMatchObject({ exif: null, read: 1 });
    // Failed: left for the next run.
    expect(columns(raw, 4)).toMatchObject({ read: 0 });
    expect(await countUnread(db)).toBe(1);
  });

  it("keeps values set by hand", async () => {
    const { raw, db } = setup();
    raw.exec(
      `UPDATE media SET latitude = 1, longitude = 2, location_source = 'manual',
         exif = '{"make":"Mine"}' WHERE id = 1`,
    );
    await backfillBatch(db, bucket(files).read, 0, 10);
    expect(columns(raw, 1)).toMatchObject({
      exif: '{"make":"Mine"}',
      latitude: 1,
      longitude: 2,
      location_source: "manual",
    });
  });

  it("keeps a world set by hand whole", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET world_id = 'wrld_mine' WHERE id = 2");
    await backfillBatch(db, bucket(files).read, 0, 10);
    expect(columns(raw, 2)).toMatchObject({
      world_id: "wrld_mine",
      world_name: null,
      world_author_id: null,
    });
  });

  it("stops with the reason when nothing can be read", async () => {
    const { db } = setup();
    const denied: ReadBytes = () =>
      Promise.reject(new Error("AdminImage.bytes: 403"));
    await expect(backfillBatch(db, denied, 0, 10)).rejects.toThrow(/403/);
    expect(await countUnread(db)).toBe(4);
  });

  it("writes the rows the schema takes when one is refused", async () => {
    const { raw, db } = setup();
    raw.exec(`CREATE TRIGGER refuse BEFORE UPDATE OF metadata_read_at ON media
      WHEN NEW.id = 1 BEGIN SELECT RAISE(ABORT, 'refused'); END`);
    expect(await backfillBatch(db, bucket(files).read, 0, 10)).toMatchObject({
      read: 4,
      failed: 1,
    });
    expect(columns(raw, 1)).toMatchObject({ read: 0 });
    expect(columns(raw, 2)).toMatchObject({ read: 1 });
  });

  it("leaves trashed photos out", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET trashed_at = '2026-01-01' WHERE id = 1");
    expect(await countUnread(db)).toBe(3);
  });

  it("goes by id in batches, and is idempotent", async () => {
    const { db } = setup();
    const b = bucket(files);
    expect(await backfillBatch(db, b.read, 0, 2)).toMatchObject({
      read: 2,
      next: 2,
    });
    expect(await backfillBatch(db, b.read, 2, 2)).toMatchObject({
      read: 2,
      next: 4,
    });
    expect(await backfillBatch(db, b.read, 4, 2)).toMatchObject({
      read: 0,
      next: null,
    });
    const before = b.calls.length;
    // A second run reads nothing again.
    expect(await backfillBatch(db, b.read, 0, 10)).toMatchObject({
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
    const b = bucket({ "/a/world.png": big });
    const spy = vi.fn(b.read);
    await backfillBatch(db, spy, 0, 10);
    expect(spy.mock.calls.map(([, r]) => r)).toEqual([
      { offset: 0, length: 128 * 1024 },
      { suffix: 64 * 1024 },
    ]);
    // The fixture itself (XMP before IDAT, whole file in the head): one read.
    const again = setup();
    again.raw.exec("DELETE FROM media WHERE id <> 2");
    const c = bucket(files);
    await backfillBatch(again.db, c.read, 0, 10);
    expect(c.calls).toHaveLength(1);
  });
});
