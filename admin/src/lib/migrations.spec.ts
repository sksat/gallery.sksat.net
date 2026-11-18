// Runs the D1 migrations against an in-memory SQLite (node:sqlite) with rows
// in the pre-0002 shape, to pin the camera backfill. E2E only ever applies
// the migrations to an empty database.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PUBLIC_ID_RE } from "./public-id";
import { CAMERA_SLUG_RE } from "./validate";

const migration = (name: string) =>
  readFileSync(resolve(__dirname, "../../migrations", name), "utf8");

const migrate = (
  rows: [
    file: string,
    world: string,
    make: string | null,
    model: string | null,
  ][],
) => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration("0001_init_media.sql"));
  const insert = db.prepare(
    "INSERT INTO media (file, world, camera_make, camera_model, tags, updated_at) VALUES (?, ?, ?, ?, '[\"t\"]', '2024-01-01T00:00:00.000Z')",
  );
  for (const r of rows) insert.run(...r);
  db.exec(migration("0002_camera.sql"));
  return db;
};

const UPDATED = "2024-01-01T00:00:00.000Z";

describe("0002_camera.sql", () => {
  it("creates one camera per make/model pair and links the photos", () => {
    const db = migrate([
      ["/v1.png", "VRChat", "logilabo", "VirtualLens2"],
      ["/v2.png", "VRChat", "logilabo", "VirtualLens2"],
      ["/r1.jpg", "Real", null, null],
      ["/r2.jpg", "Real", "Canon", "EOS 5D Mark II"],
    ]);
    expect(
      db
        .prepare(
          "SELECT slug, name, manufacturer, manufacturer_url, model, kind FROM camera ORDER BY slug",
        )
        .all(),
    ).toEqual([
      {
        slug: "eos-5d-mark-ii",
        name: "EOS 5D Mark II",
        manufacturer: "Canon",
        manufacturer_url: null,
        model: "EOS 5D Mark II",
        kind: null,
      },
      {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        manufacturer_url: null,
        model: "VirtualLens2",
        kind: "virtual",
      },
    ]);
    expect(
      db
        .prepare(
          "SELECT m.id, m.file, c.slug, m.tags, m.updated_at FROM media m LEFT JOIN camera c ON c.id = m.camera_id ORDER BY m.id",
        )
        .all(),
    ).toEqual([
      {
        id: 1,
        file: "/v1.png",
        slug: "virtuallens2",
        tags: '["t"]',
        updated_at: UPDATED,
      },
      {
        id: 2,
        file: "/v2.png",
        slug: "virtuallens2",
        tags: '["t"]',
        updated_at: UPDATED,
      },
      {
        id: 3,
        file: "/r1.jpg",
        slug: null,
        tags: '["t"]',
        updated_at: UPDATED,
      },
      {
        id: 4,
        file: "/r2.jpg",
        slug: "eos-5d-mark-ii",
        tags: '["t"]',
        updated_at: UPDATED,
      },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("drops the old camera columns", () => {
    const db = migrate([]);
    const cols = db
      .prepare("SELECT name FROM pragma_table_info('media')")
      .all()
      .map((r) => r.name);
    expect(cols).toContain("camera_id");
    expect(cols).not.toContain("camera_make");
    expect(cols).not.toContain("camera_model");
  });

  it("generates slugs the admin accepts, deduplicating shared ones", () => {
    const db = migrate([
      ["/a", "Real", "A", "Foo / Bar"],
      ["/b", "Real", "B", "foo-bar"],
      ["/c", "Real", "C", "カメラ"],
      ["/d", "Real", "D", " .X_Y. "],
    ]);
    const slugs = db
      .prepare("SELECT slug FROM camera ORDER BY manufacturer")
      .all()
      .map((r) => r.slug);
    expect(slugs).toEqual(["foo-bar", "foo-bar-2", "camera", "x-y"]);
    for (const s of slugs) expect(s).toMatch(CAMERA_SLUG_RE);
  });

  it("keeps one row per camera image file and drops them with the camera", () => {
    const db = migrate([]);
    db.exec(
      "INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A'), (2, 'b', 'B')",
    );
    db.exec(
      "INSERT INTO camera_image (camera_id, file) VALUES (1, '/c/a.png'), (2, '/c/a.png')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO camera_image (camera_id, file) VALUES (1, '/c/a.png')",
      ),
    ).toThrow(/UNIQUE/);
    db.exec("DELETE FROM camera WHERE id = 1");
    expect(db.prepare("SELECT camera_id FROM camera_image").all()).toEqual([
      { camera_id: 2 },
    ]);
  });

  it("rejects deleting a camera that still has photos", () => {
    const db = migrate([["/v1.png", "VRChat", "logilabo", "VirtualLens2"]]);
    expect(() => db.exec("DELETE FROM camera")).toThrow(/FOREIGN KEY/);
  });
});

describe("0003_visibility.sql", () => {
  const migrate3 = (rows: Parameters<typeof migrate>[0]) => {
    const db = migrate(rows);
    db.exec(migration("0003_visibility.sql"));
    return db;
  };

  // Two files of the production media.json and one that was never in it.
  const A = "/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png";
  const B = "/2023-12-comsys2023/1212816_0002.JPG";
  const UNPUBLISHED = "/2023-12-comsys2023/1212816_0001.JPG";

  it("makes published photos public, the rest private, all with a public id", () => {
    const db = migrate3([
      [A, "VRChat", "logilabo", "VirtualLens2"],
      [B, "Real", null, null],
      [UNPUBLISHED, "Real", null, null],
    ]);
    const rows = db
      .prepare(
        "SELECT m.id, m.file, m.visibility, m.public_id, c.slug, m.tags, m.updated_at FROM media m LEFT JOIN camera c ON c.id = m.camera_id ORDER BY m.id",
      )
      .all();
    expect(rows.map(({ public_id: _, ...r }) => r)).toEqual([
      {
        id: 1,
        file: A,
        visibility: "public",
        slug: "virtuallens2",
        tags: '["t"]',
        updated_at: "2024-01-01T00:00:00.000Z",
      },
      {
        id: 2,
        file: B,
        visibility: "public",
        slug: null,
        tags: '["t"]',
        updated_at: "2024-01-01T00:00:00.000Z",
      },
      {
        id: 3,
        file: UNPUBLISHED,
        visibility: "private",
        slug: null,
        tags: '["t"]',
        updated_at: "2024-01-01T00:00:00.000Z",
      },
    ]);
    const ids = rows.map((r) => r.public_id as string);
    for (const id of ids) expect(id).toMatch(PUBLIC_ID_RE);
    expect(new Set(ids).size).toBe(ids.length);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("freezes the old media.json position of known files", () => {
    const db = migrate3([
      ["/2023-12-comsys2023/1212816_0028.JPG", "Real", null, null],
      [
        "/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png",
        "VRChat",
        null,
        null,
      ],
      ["/new.png", "Real", null, null],
    ]);
    expect(
      db.prepare("SELECT file, legacy_index FROM media ORDER BY id").all(),
    ).toEqual([
      { file: "/2023-12-comsys2023/1212816_0028.JPG", legacy_index: 50 },
      {
        file: "/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png",
        legacy_index: 0,
      },
      { file: "/new.png", legacy_index: null },
    ]);
  });

  it("keeps the id counter past deleted rows", () => {
    const db = migrate([
      ["/a", "Real", null, null],
      ["/b", "Real", null, null],
    ]);
    db.exec("DELETE FROM media WHERE id = 2");
    db.exec(migration("0003_visibility.sql"));
    db.exec("INSERT INTO media (file, world) VALUES ('/c', 'Real')");
    expect(db.prepare("SELECT id FROM media WHERE file = '/c'").get()).toEqual({
      id: 3,
    });
    expect(
      db
        .prepare(
          "SELECT name, seq FROM sqlite_sequence WHERE name LIKE 'media%'",
        )
        .all(),
    ).toEqual([{ name: "media", seq: 3 }]);
  });

  it("defaults new photos to private and fills in a public id", () => {
    const db = migrate3([]);
    db.exec("INSERT INTO media (file, world) VALUES ('/n.png', 'Real')");
    const row = db
      .prepare("SELECT visibility, public_id, legacy_index FROM media")
      .get();
    expect(row?.visibility).toBe("private");
    expect(row?.public_id).toMatch(PUBLIC_ID_RE);
    expect(row?.legacy_index).toBeNull();
  });

  it("never changes a public id once set", () => {
    const db = migrate3([["/a", "Real", null, null]]);
    expect(() => db.exec("UPDATE media SET public_id = 'abcdefghjk'")).toThrow(
      /cannot be changed/,
    );
    expect(() => db.exec("UPDATE media SET public_id = NULL")).toThrow(
      /cannot be changed/,
    );
    // Other columns stay editable.
    db.exec("UPDATE media SET visibility = 'unlisted', tags = '[]'");
    expect(db.prepare("SELECT visibility FROM media").get()).toEqual({
      visibility: "unlisted",
    });
  });

  it("rejects bad visibility, malformed or duplicate public ids", () => {
    const db = migrate3([]);
    db.exec(
      "INSERT INTO media (file, world, public_id) VALUES ('/a', 'Real', 'abcdefghjk')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO media (file, world, visibility) VALUES ('/b', 'Real', 'hidden')",
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      db.exec(
        "INSERT INTO media (file, world, public_id) VALUES ('/c', 'Real', 'abcdefghjk')",
      ),
    ).toThrow(/UNIQUE/);
    for (const bad of ["abcdefghj", "abcdefghjo", "ABCDEFGHJK"]) {
      expect(() =>
        db.exec(
          `INSERT INTO media (file, world, public_id) VALUES ('/d', 'Real', '${bad}')`,
        ),
      ).toThrow(/CHECK/);
    }
  });
});

describe("0004_upload.sql", () => {
  const migrate4 = (rows: Parameters<typeof migrate>[0]) => {
    const db = migrate(rows);
    db.exec(migration("0003_visibility.sql"));
    db.exec(migration("0004_upload.sql"));
    return db;
  };
  const SHA = "a".repeat(64);

  it("marks existing photos ready, with no upload data", () => {
    const db = migrate4([["/a.png", "Real", null, null]]);
    expect(
      db
        .prepare("SELECT file, status, size, sha256, uploaded_at FROM media")
        .all(),
    ).toEqual([
      {
        file: "/a.png",
        status: "ready",
        size: null,
        sha256: null,
        uploaded_at: null,
      },
    ]);
  });

  it("keeps the public id triggers", () => {
    const db = migrate4([]);
    db.exec(
      "INSERT INTO media (file, world, status) VALUES ('/n.png', 'Real', 'uploading')",
    );
    const row = db.prepare("SELECT public_id, visibility FROM media").get();
    expect(row?.public_id).toMatch(PUBLIC_ID_RE);
    expect(row?.visibility).toBe("private");
    expect(() => db.exec("UPDATE media SET public_id = 'abcdefghjk'")).toThrow(
      /cannot be changed/,
    );
  });

  it("allows many legacy rows without a hash but no duplicate hash", () => {
    const db = migrate4([
      ["/a.png", "Real", null, null],
      ["/b.png", "Real", null, null],
    ]);
    db.exec(
      `INSERT INTO media (file, world, sha256, size) VALUES ('/c.png', 'Real', '${SHA}', 10)`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO media (file, world, sha256) VALUES ('/d.png', 'Real', '${SHA}')`,
      ),
    ).toThrow(/UNIQUE/);
  });

  it("rejects bad status, size and hash values", () => {
    const db = migrate4([]);
    for (const sql of [
      "INSERT INTO media (file, world, status) VALUES ('/a', 'Real', 'failed')",
      "INSERT INTO media (file, world, size) VALUES ('/b', 'Real', -1)",
      `INSERT INTO media (file, world, sha256) VALUES ('/c', 'Real', '${"A".repeat(64)}')`,
      "INSERT INTO media (file, world, sha256) VALUES ('/d', 'Real', 'abc')",
    ]) {
      expect(() => db.exec(sql), sql).toThrow(/CHECK/);
    }
  });

  it("stores folder paths once, in the normalised shape only", () => {
    const db = migrate4([]);
    db.exec("INSERT INTO folder (path) VALUES ('/VRChat/2026-11')");
    expect(() =>
      db.exec("INSERT INTO folder (path) VALUES ('/VRChat/2026-11')"),
    ).toThrow(/UNIQUE/);
    for (const bad of ["/", "", "a", "/a/", "/a//b", "/a b", "/a?b", "/日本"]) {
      expect(
        () => db.exec(`INSERT INTO folder (path) VALUES ('${bad}')`),
        bad,
      ).toThrow(/CHECK/);
    }
    expect(
      db.prepare("SELECT created_at FROM folder").get()?.created_at,
    ).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

describe("0005_path_trash.sql", () => {
  const migrate5 = (rows: Parameters<typeof migrate>[0]) => {
    const db = migrate(rows);
    db.exec(migration("0003_visibility.sql"));
    db.exec(migration("0004_upload.sql"));
    db.exec(migration("0005_path_trash.sql"));
    return db;
  };

  it("shows existing photos where their files are, none trashed", () => {
    const db = migrate5([["/a/x.png", "Real", null, null]]);
    expect(
      db.prepare("SELECT file, path, trashed_at FROM media").all(),
    ).toEqual([{ file: "/a/x.png", path: "/a/x.png", trashed_at: null }]);
  });

  it("fills in the path of a row inserted without one", () => {
    const db = migrate5([]);
    db.exec("INSERT INTO media (file, platform) VALUES ('/n.png', 'Real')");
    db.exec(
      "INSERT INTO media (file, platform, path) VALUES ('/k.png', 'Real', '/moved/k.png')",
    );
    expect(
      db.prepare("SELECT file, path FROM media ORDER BY id").all(),
    ).toEqual([
      { file: "/n.png", path: "/n.png" },
      { file: "/k.png", path: "/moved/k.png" },
    ]);
  });

  it("gives a path to one live photo, but not to trashed ones", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    expect(() =>
      db.exec(
        "INSERT INTO media (file, platform, path) VALUES ('/b.png', 'Real', '/a.png')",
      ),
    ).toThrow(/UNIQUE/);
    db.exec("UPDATE media SET trashed_at = '2026-11-18T00:00:00Z'");
    db.exec(
      "INSERT INTO media (file, platform, path) VALUES ('/b.png', 'Real', '/a.png')",
    );
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM media WHERE path = '/a.png'").get(),
    ).toEqual({ n: 2 });
  });

  it("renames world to platform, keeping its values and CHECK", () => {
    const db = migrate5([
      ["/a.png", "Real", null, null],
      ["/v.png", "VRChat", null, null],
    ]);
    expect(db.prepare("SELECT platform FROM media ORDER BY id").all()).toEqual([
      { platform: "Real" },
      { platform: "VRChat" },
    ]);
    expect(() =>
      db.exec("INSERT INTO media (file, platform) VALUES ('/m.png', 'Mars')"),
    ).toThrow(/CHECK/);
    expect(() => db.prepare("SELECT world FROM media").all()).toThrow();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_media_%' ORDER BY name",
        )
        .all()
        .map((r) => r.name),
    ).toContain("idx_media_platform");
  });

  it("hides every file name to begin with, new photos too", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    db.exec("INSERT INTO media (file, platform) VALUES ('/b.png', 'Real')");
    expect(
      db.prepare("SELECT filename_public FROM media ORDER BY id").all(),
    ).toEqual([{ filename_public: 0 }, { filename_public: 0 }]);
    expect(() => db.exec("UPDATE media SET filename_public = 2")).toThrow(
      /CHECK/,
    );
  });

  it("rejects malformed paths", () => {
    const db = migrate5([]);
    for (const bad of ["a.png", "/a/", "/a//b.png", "/"]) {
      expect(
        () =>
          db.exec(
            `INSERT INTO media (file, platform, path) VALUES ('/x${bad.length}.png', 'Real', '${bad}')`,
          ),
        bad,
      ).toThrow(/CHECK/);
    }
  });
});
