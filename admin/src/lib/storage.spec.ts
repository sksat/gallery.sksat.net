import { describe, expect, it } from "vitest";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import {
  fetchStorageRows,
  formatDecimalBytes,
  formatPercent,
  formatUsd,
  monthlyCostUsd,
  percentOf,
  summarizeStorage,
} from "./storage";

describe("formatDecimalBytes (base 1000)", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1.00 KB"],
    [1234, "1.23 KB"],
    [12_345, "12.3 KB"],
    [123_456, "123 KB"],
    [9_999, "10.0 KB"],
    [99_990_000, "100 MB"],
    [999_499, "999 KB"],
    [999_999, "1.00 MB"],
    [2_780_000_000, "2.78 GB"],
    [10_000_000_000, "10.0 GB"],
    [1_500_000_000_000, "1.50 TB"],
  ])("%d -> %s", (n, s) => {
    expect(formatDecimalBytes(n)).toBe(s);
  });

  it("does not format nonsense", () => {
    expect(formatDecimalBytes(-1)).toBe("—");
    expect(formatDecimalBytes(Number.NaN)).toBe("—");
  });
});

describe("monthlyCostUsd", () => {
  it("charges every byte, with no free tier", () => {
    expect(monthlyCostUsd(0)).toBe(0);
    expect(monthlyCostUsd(30e6)).toBeCloseTo(0.0002085, 9);
    expect(monthlyCostUsd(10e9)).toBeCloseTo(0.0695);
  });

  it("charges $0.00695 per GB ($6.95 per TB)", () => {
    expect(monthlyCostUsd(1e9)).toBeCloseTo(0.00695);
    expect(monthlyCostUsd(1e12)).toBeCloseTo(6.95);
  });
});

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [0.003, "< $0.01"],
    [0.006, "$0.01"],
    [1.234, "$1.23"],
  ])("%d -> %s", (n, s) => {
    expect(formatUsd(n)).toBe(s);
  });
});

describe("percentOf", () => {
  it("clamps and handles an empty whole", () => {
    expect(percentOf(1, 4)).toBe(25);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("formatPercent", () => {
  it.each([
    [0, 100, "0%"],
    [1, 10_000, "< 0.1%"],
    [123, 1000, "12.3%"],
    [150, 100, "150.0%"],
    [1, 0, "—"],
  ])("%d of %d -> %s", (p, w, s) => expect(formatPercent(p, w)).toBe(s));
});

describe("storage (on the real schema)", () => {
  const setup = () => {
    const db = migratedSqlite();
    db.exec(`INSERT INTO media (file, platform, visibility, size) VALUES
        ('/VRChat/2023-12/a.png', 'VRChat', 'public',   1000),
        ('/VRChat/b.png',         'VRChat', 'unlisted', 2000),
        ('/2023-12-comsys2023/c.jpg', 'Real', 'public', 4000),
        ('/root.png',             'Real',   'private',  NULL);
      INSERT INTO media (file, platform, status, size) VALUES
        ('/VRChat/up.png', 'VRChat', 'uploading', 8000);`);
    return sqliteD1(db);
  };

  it("adds up ready photos by visibility and top-level folder", async () => {
    const s = summarizeStorage((await fetchStorageRows(setup())).rows);
    expect(s).toEqual({
      total: { count: 4, bytes: 7000 },
      byVisibility: {
        public: { count: 2, bytes: 5000 },
        unlisted: { count: 1, bytes: 2000 },
        private: { count: 1, bytes: 0 },
      },
      byFolder: [
        { folder: "/2023-12-comsys2023", count: 1, bytes: 4000 },
        { folder: "/VRChat", count: 2, bytes: 3000 },
        { folder: "/", count: 1, bytes: 0 },
      ],
      uploading: { count: 1, bytes: 8000 },
      unsized: 1,
    });
  });

  it("passes on D1's database size from the result's meta", async () => {
    const fake = {
      prepare: () => ({
        all: async () => ({ results: [], meta: { size_after: 123_456 } }),
      }),
    } as unknown as D1Database;
    expect(await fetchStorageRows(fake)).toEqual({
      rows: [],
      dbBytes: 123_456,
    });
    // node:sqlite stand-in has no size_after.
    expect((await fetchStorageRows(setup())).dbBytes).toBeNull();
  });

  it("is all zeros for an empty database", async () => {
    const s = summarizeStorage(
      (await fetchStorageRows(sqliteD1(migratedSqlite()))).rows,
    );
    expect(s.total).toEqual({ count: 0, bytes: 0 });
    expect(s.byFolder).toEqual([]);
    expect(s.uploading).toEqual({ count: 0, bytes: 0 });
  });
});
