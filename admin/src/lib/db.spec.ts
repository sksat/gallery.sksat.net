import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  listMedia,
  restoreCameraImageStatements,
  rowToCamera,
  rowToMedia,
} from "./db";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import type { CameraRow } from "./types";

const UPDATED = "2025-05-03T10:00:00.000Z";

const vl2: CameraRow = {
  id: 1,
  slug: "virtuallens2",
  name: "VirtualLens2",
  manufacturer: "logilabo",
  manufacturer_url: "https://logilabo.booth.pm/",
  model: "VirtualLens2",
  kind: "virtual",
  description: null,
  product_url: null,
  updated_at: UPDATED,
};

// Columns added by 0003_visibility.sql, for raw rows.
const NEW_COLS = {
  public_id: "abcdefghjk",
  visibility: "unlisted",
  metadata_visibility: '{"taken_at":"date","camera":"x","bogus":"x"}',
  updated_at: UPDATED,
};

describe("rowToMedia", () => {
  it("parses tags JSON and preserves nullable fields", () => {
    const row = rowToMedia({
      id: 1,
      file: "/VRChat/2023-12/x.png",
      platform: "VRChat",
      timestamp: "2023-12-11T01:21:32.519+09:00",
      camera_id: 4,
      tags: '["VRChat","portrait"]',
      ...NEW_COLS,
    });
    expect(row.tags).toEqual(["VRChat", "portrait"]);
    expect(row.public_id).toBe("abcdefghjk");
    expect(row.visibility).toBe("unlisted");
    // Unknown fields are dropped; an unknown level reads as hidden.
    expect(row.metadata_visibility).toEqual({
      taken_at: "date",
      camera: "hidden",
    });
    expect(row.camera_id).toBe(4);
    expect(row.timestamp).toBe("2023-12-11T01:21:32.519+09:00");
  });

  it("handles empty tags and missing camera", () => {
    const row = rowToMedia({
      id: 2,
      file: "/Real/x.jpg",
      platform: "Real",
      timestamp: null,
      camera_id: null,
      tags: "[]",
      ...NEW_COLS,
    });
    expect(row.tags).toEqual([]);
    expect(row.camera_id).toBeNull();
  });

  it("keeps any platform key (the table has them, 0014)", () => {
    const row = rowToMedia({
      id: 3,
      file: "x",
      platform: "Neos-VR",
      timestamp: null,
      camera_id: null,
      tags: "[]",
      ...NEW_COLS,
    });
    expect(row.platform).toBe("Neos-VR");
  });

  it("rejects unknown visibility value", () => {
    expect(() =>
      rowToMedia({
        id: 3,
        file: "x",
        platform: "Real",
        timestamp: null,
        camera_id: null,
        tags: "[]",
        ...NEW_COLS,
        visibility: "secret",
      }),
    ).toThrow(/unknown visibility/);
  });

  it("rejects a JSON array whose elements are not strings", () => {
    expect(() =>
      rowToMedia({
        id: 4,
        file: "x",
        platform: "Real",
        timestamp: null,
        camera_id: null,
        tags: "[1,2,3]",
        ...NEW_COLS,
      }),
    ).toThrow(/tags column/);
  });

  it("reports invalid (non-JSON) tags column with context", () => {
    expect(() =>
      rowToMedia({
        id: 5,
        file: "x",
        platform: "Real",
        timestamp: null,
        camera_id: null,
        tags: "not json",
        ...NEW_COLS,
      }),
    ).toThrow(/not valid JSON/);
  });
});

describe("rowToCamera", () => {
  it("accepts a null kind", () => {
    expect(rowToCamera({ ...vl2, kind: null }).kind).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(() => rowToCamera({ ...vl2, kind: "drone" })).toThrow(
      /unknown camera kind/,
    );
  });
});

// restoreCameraImage's statements against the real schema (node:sqlite),
// run in one transaction like a D1 batch.
describe("restoreCameraImageStatements", () => {
  const migration = (name: string) =>
    readFileSync(resolve(__dirname, "../../migrations", name), "utf8");

  /** Camera 1 with pictures at these positions (files a, b, c, ...). */
  const setup = (positions: number[]) => {
    const db = new DatabaseSync(":memory:");
    const dir = resolve(__dirname, "../../migrations");
    for (const m of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      db.exec(migration(m));
    }
    db.exec(
      "INSERT INTO camera (id, slug, name, updated_at) VALUES (1, 'c', 'C', '2024-01-01T00:00:00.000Z')",
    );
    const insert = db.prepare(
      "INSERT INTO camera_image (camera_id, file, position) VALUES (1, ?, ?)",
    );
    positions.forEach((p, i) =>
      insert.run(`/${String.fromCharCode(97 + i)}.png`, p),
    );
    return db;
  };

  const restore = (db: DatabaseSync, file: string, index: number) => {
    db.exec("BEGIN");
    try {
      for (const { sql, args } of restoreCameraImageStatements(
        1,
        { file, media_id: null, caption: "back" },
        index,
      )) {
        db.prepare(sql).run(...(args as (string | number | null)[]));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  const order = (db: DatabaseSync) =>
    db
      .prepare(
        "SELECT file FROM camera_image WHERE camera_id = 1 ORDER BY position, id",
      )
      .all()
      .map((r) => (r as { file: string }).file);

  it("puts the picture back at its index, also across gaps", () => {
    // a, b, c with a gap where a removed one was.
    const db = setup([0, 2, 3]);
    restore(db, "/x.png", 1);
    expect(order(db)).toEqual(["/a.png", "/x.png", "/b.png", "/c.png"]);
    restore(db, "/y.png", 0);
    expect(order(db)).toEqual([
      "/y.png",
      "/a.png",
      "/x.png",
      "/b.png",
      "/c.png",
    ]);
  });

  it("keeps the order of tied positions", () => {
    // a, b, c with b and c tied (ordered by id).
    for (const [index, expected] of [
      [1, ["/a.png", "/x.png", "/b.png", "/c.png"]],
      [2, ["/a.png", "/b.png", "/x.png", "/c.png"]],
    ] as const) {
      const db = setup([0, 1, 1]);
      restore(db, "/x.png", index);
      expect(order(db)).toEqual(expected);
    }
  });

  it("appends past the end and into an empty list", () => {
    const db = setup([0, 1]);
    restore(db, "/x.png", 9);
    expect(order(db)).toEqual(["/a.png", "/b.png", "/x.png"]);
    const empty = setup([]);
    restore(empty, "/x.png", 3);
    expect(order(empty)).toEqual(["/x.png"]);
  });

  it("changes nothing when the file is already there again", () => {
    const db = setup([0, 1]);
    expect(() => restore(db, "/b.png", 0)).toThrow(/UNIQUE/);
    expect(order(db)).toEqual(["/a.png", "/b.png"]);
  });
});

describe("listMedia", () => {
  const setup = () => {
    const raw = migratedSqlite();
    raw.exec(`
      INSERT INTO camera (id, slug, name) VALUES (1, 'eos-r5', 'EOS R5');
      INSERT INTO media (id, file, platform, timestamp, camera_id) VALUES
        (1, '/a.png', 'Real', '2026-01-01T00:00:00Z', 1),
        (2, '/b.png', 'Real', '2026-01-02T00:00:00Z', NULL),
        (3, '/c.png', 'Real', NULL, 1),
        (4, '/d.png', 'Real', '2026-01-03T00:00:00Z', 1);
    `);
    return sqliteD1(raw);
  };

  it("gives each row its camera's name, in the list's order", async () => {
    const { rows, total } = await listMedia(setup(), { limit: 10, offset: 0 });
    expect(total).toBe(4);
    expect(rows.map((r) => [r.id, r.camera_name])).toEqual([
      [4, "EOS R5"],
      [2, null],
      [1, "EOS R5"],
      [3, "EOS R5"],
    ]);
  });

  it("pages before joining, and keeps the page's order", async () => {
    const { rows } = await listMedia(setup(), { limit: 2, offset: 1 });
    expect(rows.map((r) => [r.id, r.camera_name])).toEqual([
      [2, null],
      [1, "EOS R5"],
    ]);
  });
});
