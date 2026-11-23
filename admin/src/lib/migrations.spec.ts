// Runs the D1 migrations against an in-memory SQLite (node:sqlite) with rows
// in the pre-0002 shape, to pin the camera backfill. E2E only ever applies
// the migrations to an empty database.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PUBLIC_ID_RE } from "./public-id";
import { CAMERA_SLUG_RE } from "./validate";
import { isScanner } from "./photo-meta";
import {
  effectiveTags,
  parseTagVisibility,
  tagShown,
} from "@shared/tag-field/tag-field";

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

  it("sets the site's metadata defaults; photos start with none of their own", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    const site = db
      .prepare("SELECT value FROM setting WHERE key = 'metadata_visibility'")
      .get() as { value: string };
    expect(JSON.parse(site.value)).toEqual({
      file_name: "hidden",
      taken_at: "second",
      camera: "model",
      tags: "public",
      location: "hidden",
      world: "link",
      exif: "basic",
    });
    expect(db.prepare("SELECT metadata_visibility FROM media").all()).toEqual([
      { metadata_visibility: null },
    ]);
    // Overrides are a JSON object, or nothing.
    db.exec(`UPDATE media SET metadata_visibility = '{"camera":"hidden"}'`);
    for (const bad of ["'nope'", `'["x"]'`, "'1'"]) {
      expect(
        () => db.exec(`UPDATE media SET metadata_visibility = ${bad}`),
        bad,
      ).toThrow(/CHECK/);
    }
    expect(() => db.exec("UPDATE setting SET value = 'nope'")).toThrow(/CHECK/);
  });

  it("makes the tags the public site shows public; new tags are private", () => {
    const db = migrate([
      ["/a.png", "Real", null, null],
      ["/b.png", "Real", null, null],
    ]);
    db.exec(`UPDATE media SET tags = '["night","t", 3]' WHERE file = '/a.png';
      UPDATE media SET tags = '["secret","t"]' WHERE file = '/b.png'`);
    db.exec(migration("0003_visibility.sql"));
    db.exec(migration("0004_upload.sql"));
    // /a.png is public, /b.png private.
    db.exec("UPDATE media SET visibility = 'public' WHERE file = '/a.png'");
    db.exec(migration("0005_path_trash.sql"));
    expect(
      db.prepare("SELECT name, public FROM tag ORDER BY name").all(),
    ).toEqual([
      { name: "night", public: 1 },
      { name: "t", public: 1 },
    ]);
    db.exec("INSERT INTO tag (name) VALUES ('draft')");
    expect(
      db.prepare("SELECT public FROM tag WHERE name = 'draft'").get(),
    ).toEqual({ public: 0 });
    expect(() => db.exec("INSERT INTO tag (name) VALUES ('night')")).toThrow(
      /UNIQUE/,
    );
  });

  it("keeps a location only as a valid pair, with its source", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    expect(
      db
        .prepare("SELECT latitude, longitude, location_source FROM media")
        .get(),
    ).toEqual({ latitude: null, longitude: null, location_source: null });
    db.exec(
      "UPDATE media SET latitude = -33.86, longitude = 151.21, location_source = 'exif'",
    );
    for (const bad of [
      "latitude = NULL",
      "longitude = NULL",
      "latitude = 91",
      "longitude = -180.5",
      "location_source = 'gps'",
    ]) {
      expect(() => db.exec(`UPDATE media SET ${bad}`), bad).toThrow(/CHECK/);
    }
    db.exec("UPDATE media SET latitude = NULL, longitude = NULL");
  });

  it("keeps exif as a JSON object and world ids as wrld_…", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    db.exec(
      `UPDATE media SET exif = '{"iso":100}', world_id = 'wrld_abc', world_name = 'W', world_author_id = 'usr_x'`,
    );
    for (const bad of [
      "exif = 'nope'",
      "exif = '[1]'",
      "world_id = 'abc'",
      "world_id = 'wrld_'",
    ]) {
      expect(() => db.exec(`UPDATE media SET ${bad}`), bad).toThrow(/CHECK/);
    }
  });

  it("leaves every photo's metadata unread", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    db.exec("INSERT INTO media (file, platform) VALUES ('/b.png', 'Real')");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM media WHERE metadata_read_at IS NULL AND status = 'ready'",
        )
        .get(),
    ).toEqual({ n: 2 });
  });

  it("drops legacy_index", () => {
    const db = migrate5([["/a.png", "Real", null, null]]);
    expect(() => db.prepare("SELECT legacy_index FROM media").all()).toThrow();
  });

  it("0008 marks what was filled in so far as the weakest automatic source", () => {
    const db = migrate5([]);
    db.exec(`INSERT INTO media (file, platform, timestamp, exif, world_name, latitude, longitude, location_source)
      VALUES ('/a.png', 'VRChat', '2026-01-01T00:00:00+09:00', '{"make":"x"}', 'W', 1, 2, 'manual'),
             ('/b.png', 'Real', NULL, NULL, NULL, NULL, NULL, NULL),
             ('/c.png', 'Real', '2026-01-01T00:00:00+09:00', NULL, NULL, NULL, NULL, NULL),
             ('/d.png', 'VRChat', NULL, '{"make":"y"}', 'V', NULL, NULL, NULL),
             ('/e.png', 'Real', NULL, '{"lens":"hand"}', NULL, NULL, NULL, NULL)`);
    db.exec(`UPDATE media SET metadata_read_at = '2026-11-01T00:00:00.000Z',
               updated_at = '2026-01-01T00:00:00.000Z';
             UPDATE media SET updated_at = '2026-11-02T00:00:00.000Z'
               WHERE file = '/d.png';
             UPDATE media SET metadata_read_at = NULL WHERE file = '/e.png'`);
    db.exec(migration("0008_metadata_source.sql"));
    const rows = db
      .prepare(
        "SELECT file, metadata_source, location_source FROM media ORDER BY file",
      )
      .all() as { file: string; metadata_source: string | null }[];
    expect(
      rows.map((r) => [
        r.file,
        r.metadata_source && JSON.parse(r.metadata_source),
      ]),
    ).toEqual([
      ["/a.png", { taken_at: "filename", exif: "file", world: "file" }],
      ["/b.png", null],
      ["/c.png", { taken_at: "filename" }],
      // Edited (visibility, tags, a move) after its file was read: still
      // automatic, updated_at says nothing about these fields.
      ["/d.png", { exif: "file", world: "file" }],
      // Never read: automatic too (nothing was entered by hand so far).
      ["/e.png", { exif: "file" }],
    ]);
    // Location keeps its own column.
    expect(rows[0]).toMatchObject({ location_source: "manual" });
    expect(() =>
      db.exec("UPDATE media SET metadata_source = '[1]' WHERE file = '/b.png'"),
    ).toThrow(/CHECK/);
  });

  it("0008 keeps the taken-at set by hand on a scanner's files", () => {
    const db = migrate5([]);
    const scan = JSON.stringify({
      make: "GCMC",
      model: "Scanner",
      taken_at_original: "2021-01-01T00:31:12",
    });
    db.exec(`INSERT INTO media (file, platform, timestamp, exif, metadata_visibility) VALUES
      ('/2024/a.jpg', 'Real', '2024-02-01T00:00:00+09:00', '${scan}', '{"taken_at":"month"}'),
      ('/2024/b.jpg', 'Real', '2024-03-08T00:00:00+09:00', '${scan}', '{"taken_at":"date"}'),
      -- Set from the folder, but no coarser level: the scanner tells.
      ('/2024/c.jpg', 'Real', '2024-03-09T00:00:00+09:00', '${scan}', NULL),
      -- Still the scan's own date: automatic (and never read again as one).
      ('/2024/d.jpg', 'Real', '2021-01-01T00:31:12+09:00', '${scan}', NULL),
      -- No DateTimeOriginal: the old parser took the scan's DateTime.
      ('/2024/g.jpg', 'Real', '2021-01-01T00:31:12+09:00',
        '{"make":"GCMC","model":"Scanner"}', NULL),
      -- A camera's date: automatic.
      ('/e.jpg', 'Real', '2023-12-11T01:21:32+09:00',
        '{"make":"FUJIFILM","model":"X-T5","taken_at_original":"2023-12-11T01:21:32+09:00"}', NULL),
      ('/f.jpg', 'Real', NULL, '${scan}', '{"taken_at":"month"}')`);
    db.exec(migration("0008_metadata_source.sql"));
    const src = (file: string) =>
      JSON.parse(
        (
          db
            .prepare("SELECT metadata_source FROM media WHERE file = ?")
            .get(file) as { metadata_source: string }
        ).metadata_source,
      );
    expect(src("/2024/a.jpg")).toEqual({ taken_at: "manual", exif: "file" });
    expect(src("/2024/b.jpg")).toEqual({ taken_at: "manual", exif: "file" });
    expect(src("/2024/c.jpg")).toEqual({ taken_at: "manual", exif: "file" });
    expect(src("/2024/d.jpg")).toEqual({ taken_at: "filename", exif: "file" });
    expect(src("/2024/g.jpg")).toEqual({ taken_at: "filename", exif: "file" });
    expect(src("/e.jpg")).toEqual({ taken_at: "filename", exif: "file" });
    expect(src("/f.jpg")).toEqual({ exif: "file" });
  });

  it("0008 knows the same scanners as isScanner", () => {
    const pairs: [string, string][] = [
      ["GCMC", "Scanner"],
      ["FUJI PHOTO FILM CO., LTD.", "SP-2000"],
      ["FUJIFILM", "SP3000"],
      ["FUJIFILM", "Frontier LP5000"],
      ["NORITSU KOKI", "QSS-32"],
      ["Eastman Kodak Company", "Pakon F-135"],
      ["Hasselblad", "Flextight X5"],
      ["Nikon", "LS-5000"],
      ["Nikon", "Nikon SUPER COOLSCAN 5000 ED"],
      ["EPSON", "Perfection V600"],
      ["Plustek", "OpticFilm 8200i"],
      ["Pacific Image", "PrimeFilm XAs"],
      ["Konica", "HS-1800"],
      ["NORITSU", "EZController"],
      ["Canon", "CanoScan 9000F Scanner"],
      ["Generic Scanner Co", "X"],
      // Odd case: LIKE and GLOB must match as the /i regexes do.
      ["fujifilm", "sp-3000"],
      ["nikon", "ls-50"],
      ["gcmc", "SCANNER"],
      ["FUJIFILM", "X-T5"],
      ["NIKON CORPORATION", "NIKON Z 6"],
      ["SONY", "ILCE-7M4"],
      ["Apple", "iPhone 15 Pro"],
      ["Canon", "Canon EOS R5"],
      ["Panasonic", "DC-S5M2"],
      ["FUJIFILM", "GFX100S"],
    ];
    const db = migrate5([]);
    pairs.forEach(([make, model], i) =>
      db
        .prepare(
          "INSERT INTO media (file, platform, timestamp, exif) VALUES (?, 'Real', '2024-01-01T00:00:00+09:00', ?)",
        )
        .run(
          `/${i}.jpg`,
          JSON.stringify({
            make,
            model,
            taken_at_original: "2021-01-01T00:00:00",
          }),
        ),
    );
    db.exec(migration("0008_metadata_source.sql"));
    pairs.forEach(([make, model], i) => {
      const { metadata_source } = db
        .prepare("SELECT metadata_source FROM media WHERE file = ?")
        .get(`/${i}.jpg`) as { metadata_source: string };
      const manual = JSON.parse(metadata_source).taken_at === "manual";
      expect(manual, `${make} ${model}`).toBe(isScanner(make, model));
    });
    expect(pairs.filter(([a, b]) => isScanner(a, b)).length).toBe(19);
  });

  describe("0009: the file's EXIF apart from the shooting info", () => {
    const GCMC = JSON.stringify({
      make: "GCMC",
      model: "Scanner",
      taken_at_original: "2021-01-01T00:31:12",
    });
    const XT5 = JSON.stringify({
      make: "FUJIFILM",
      model: "X-T5",
      f_number: 2.8,
      taken_at_original: "2023-12-11T01:21:32+09:00",
    });
    /** Up to 0008, these rows, then 0009. */
    const migrate9 = (insert: string, before = "") => {
      const db = migrate5([]);
      db.exec(migration("0007_list_indexes.sql"));
      db.exec(insert);
      db.exec(migration("0008_metadata_source.sql"));
      if (before) db.exec(before);
      db.exec(migration("0009_file_exif.sql"));
      return db;
    };
    const row = (db: DatabaseSync, file: string) =>
      db
        .prepare(
          `SELECT timestamp, exif, file_exif, digitized_at, digitized_with,
             embed_exif, metadata_source FROM media WHERE file = ?`,
        )
        .get(file) as Record<string, unknown>;

    it("moves a GCMC Scanner's EXIF and unset-clock date off the photo", () => {
      const db =
        migrate9(`INSERT INTO media (file, platform, timestamp, exif, metadata_visibility) VALUES
        -- Still the scanner's date: cleared, so 2021-01-01 leaves the calendars.
        ('/2024/auto.jpg', 'Real', '2021-01-01T00:31:12+09:00', '${GCMC}', NULL),
        -- Set by hand from the folder (0008 marks it manual): kept.
        ('/2024/month.jpg', 'Real', '2024-02-01T00:00:00+09:00', '${GCMC}', '{"taken_at":"month"}'),
        ('/2024/date.jpg', 'Real', '2024-03-08T00:00:00+09:00', '${GCMC}', '{"taken_at":"date"}'),
        -- A camera's file: everything stays, its EXIF also kept as the file's.
        ('/x-t5.jpg', 'Real', '2023-12-11T01:21:32+09:00', '${XT5}', NULL),
        ('/none.png', 'Real', NULL, NULL, NULL)`);
      expect(row(db, "/2024/auto.jpg")).toEqual({
        timestamp: null,
        exif: null,
        file_exif: GCMC,
        digitized_at: "2021-01-01T00:31:12+09:00",
        digitized_with: null,
        embed_exif: null,
        metadata_source: null,
      });
      expect(row(db, "/2024/month.jpg")).toMatchObject({
        timestamp: "2024-02-01T00:00:00+09:00",
        exif: null,
        file_exif: GCMC,
        digitized_at: "2021-01-01T00:31:12+09:00",
        metadata_source: '{"taken_at":"manual"}',
      });
      expect(row(db, "/2024/date.jpg")).toMatchObject({
        timestamp: "2024-03-08T00:00:00+09:00",
        metadata_source: '{"taken_at":"manual"}',
      });
      expect(row(db, "/x-t5.jpg")).toEqual({
        timestamp: "2023-12-11T01:21:32+09:00",
        exif: XT5,
        file_exif: XT5,
        digitized_at: null,
        digitized_with: null,
        embed_exif: null,
        metadata_source: '{"taken_at":"filename","exif":"file"}',
      });
      expect(row(db, "/none.png")).toMatchObject({
        file_exif: null,
        digitized_at: null,
      });
      expect(
        db.prepare("SELECT value FROM setting WHERE key = 'embed_exif'").get(),
      ).toEqual({ value: "true" });
    });

    it("never touches a value entered by hand", () => {
      const db = migrate9(
        `INSERT INTO media (file, platform, timestamp, exif) VALUES
          ('/a.jpg', 'Real', '2021-01-01T00:31:12+09:00', '${GCMC}')`,
        // As if edited by hand after 0008, before 0009.
        `UPDATE media SET metadata_source = '{"taken_at":"manual","exif":"manual"}'`,
      );
      expect(row(db, "/a.jpg")).toMatchObject({
        timestamp: "2021-01-01T00:31:12+09:00",
        // The scanner's own keys are not the edit: they go, else they would
        // be public as the camera's.
        exif: null,
        // An edited exif is not the file's: the reader fills this later.
        file_exif: null,
        digitized_at: "2021-01-01T00:31:12+09:00",
        metadata_source: '{"taken_at":"manual","exif":"manual"}',
      });
    });

    it("clears an automatic taken-at of a scanner's file without DateTimeOriginal", () => {
      // The old parser took EXIF DateTime then: the scan's too.
      const db = migrate9(
        `INSERT INTO media (file, platform, timestamp, exif) VALUES
          ('/a.jpg', 'Real', '2021-01-01T00:31:12+09:00', '{"make":"GCMC","model":"Scanner"}')`,
      );
      expect(row(db, "/a.jpg")).toMatchObject({
        timestamp: null,
        exif: null,
        digitized_at: null,
      });
    });

    it("keeps the hand-typed exposure of a scanner's photo, not its make", () => {
      const edited = JSON.stringify({
        make: "GCMC",
        model: "Scanner",
        taken_at_original: "2021-01-01T00:31:12",
        f_number: 8,
        iso: 400,
      });
      const db = migrate9(
        `INSERT INTO media (file, platform, exif) VALUES ('/a.jpg', 'Real', '${edited}')`,
        `UPDATE media SET metadata_source = '{"exif":"manual"}'`,
      );
      expect(JSON.parse(row(db, "/a.jpg").exif as string)).toEqual({
        f_number: 8,
        iso: 400,
      });
    });

    it("links a camera row that already names the scanner", () => {
      const db = migrate5([]);
      db.exec(migration("0007_list_indexes.sql"));
      db.exec(`INSERT INTO camera (slug, name, manufacturer, model)
        VALUES ('scanner', 'Scanner', 'gcmc', 'SCANNER')`);
      db.exec(
        `INSERT INTO media (file, platform, exif) VALUES ('/a.jpg', 'Real', '${GCMC}')`,
      );
      db.exec(migration("0008_metadata_source.sql"));
      db.exec(migration("0009_file_exif.sql"));
      expect(row(db, "/a.jpg").digitized_with).toBe(
        (db.prepare("SELECT id FROM camera").get() as { id: number }).id,
      );
    });

    it("lets camera.kind be 'scanner', keeping the rows, pictures and links", () => {
      const db = migrate5([]);
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(migration("0007_list_indexes.sql"));
      db.exec(
        `INSERT INTO camera (slug, name, kind) VALUES ('fm2', 'FM2', 'film')`,
      );
      db.exec(
        `INSERT INTO camera_image (camera_id, file) VALUES (1, '/camera/fm2/a.png')`,
      );
      db.exec(
        `INSERT INTO media (file, platform, camera_id) VALUES ('/a.jpg', 'Real', 1)`,
      );
      db.exec(migration("0008_metadata_source.sql"));
      db.exec(migration("0009_file_exif.sql"));
      expect(db.prepare("SELECT id, slug, kind FROM camera").all()).toEqual([
        { id: 1, slug: "fm2", kind: "film" },
      ]);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM camera_image").get(),
      ).toEqual({ n: 1 });
      expect(db.prepare("SELECT camera_id FROM media").get()).toEqual({
        camera_id: 1,
      });
      db.exec(
        `INSERT INTO camera (slug, name, kind) VALUES ('s', 'S', 'scanner')`,
      );
      expect(() =>
        db.exec(
          `INSERT INTO camera (slug, name, kind) VALUES ('t', 'T', 'toaster')`,
        ),
      ).toThrow(/CHECK/);
      expect(() => db.exec("UPDATE media SET digitized_with = 99")).toThrow(
        /FOREIGN KEY/,
      );
      expect(() => db.exec("UPDATE media SET embed_exif = 2")).toThrow(/CHECK/);
    });

    it("knows the same scanners as isScanner", () => {
      const pairs: [string, string][] = [
        ["GCMC", "Scanner"],
        ["gcmc", "SCANNER"],
        ["FUJI PHOTO FILM CO., LTD.", "SP-2000"],
        ["fujifilm", "sp-3000"],
        ["FUJIFILM", "Frontier LP5000"],
        ["NORITSU KOKI", "QSS-32"],
        ["Eastman Kodak Company", "Pakon F-135"],
        ["Hasselblad", "Flextight X5"],
        ["nikon", "ls-50"],
        ["Nikon", "Nikon SUPER COOLSCAN 5000 ED"],
        ["EPSON", "Perfection V600"],
        ["Plustek", "OpticFilm 8200i"],
        ["Pacific Image", "PrimeFilm XAs"],
        ["Konica", "HS-1800"],
        ["NORITSU", "EZController"],
        ["Generic Scanner Co", "X"],
        ["FUJIFILM", "X-T5"],
        ["NIKON CORPORATION", "NIKON Z 6"],
        ["SONY", "ILCE-7M4"],
        ["Apple", "iPhone 15 Pro"],
        ["FUJIFILM", "GFX100S"],
      ];
      const db = migrate5([]);
      db.exec(migration("0007_list_indexes.sql"));
      pairs.forEach(([make, model], i) =>
        db
          .prepare(
            "INSERT INTO media (file, platform, exif) VALUES (?, 'Real', ?)",
          )
          .run(
            `/${i}.jpg`,
            JSON.stringify({
              make,
              model,
              taken_at_original: "2021-01-01T00:00:00",
            }),
          ),
      );
      db.exec(migration("0008_metadata_source.sql"));
      db.exec(migration("0009_file_exif.sql"));
      pairs.forEach(([make, model], i) => {
        const digitized = row(db, `/${i}.jpg`).digitized_at !== null;
        expect(digitized, `${make} ${model}`).toBe(isScanner(make, model));
      });
    });
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

describe("0011_camera_tag.sql", () => {
  it("keeps one row per camera and tag, gone with the camera", () => {
    const db = migrate([["/a.png", "Real", null, null]]);
    for (const f of [
      "0003_visibility.sql",
      "0004_upload.sql",
      "0005_path_trash.sql",
      "0007_list_indexes.sql",
      "0010_tag_field.sql",
      "0011_camera_tag.sql",
    ]) {
      db.exec(migration(f));
    }
    db.exec(
      "INSERT INTO camera (id, slug, name) VALUES (9, 'x', 'X'); INSERT INTO camera_tag (camera_id, tag) VALUES (9, 'フィルム')",
    );
    expect(
      db.prepare("SELECT propagate, position FROM camera_tag").get(),
    ).toEqual({ propagate: 1, position: 0 });
    expect(() =>
      db.exec("INSERT INTO camera_tag (camera_id, tag) VALUES (9, 'フィルム')"),
    ).toThrow(/UNIQUE|PRIMARY/);
    for (const bad of ["(9, '', 1)", "(9, 'a', 2)", "(99, 'a', 1)"]) {
      expect(
        () =>
          db.exec(
            `INSERT INTO camera_tag (camera_id, tag, propagate) VALUES ${bad}`,
          ),
        bad,
      ).toThrow(/CHECK|FOREIGN KEY/);
    }
    db.exec("DELETE FROM camera WHERE id = 9");
    expect(db.prepare("SELECT COUNT(*) AS n FROM camera_tag").get()).toEqual({
      n: 0,
    });
  });
});

describe("0016_media_size.sql", () => {
  it("leaves existing photos unsized and takes positive sizes only", () => {
    const db = migrate([["/a.png", "Real", null, null]]);
    for (const f of [
      "0003_visibility.sql",
      "0004_upload.sql",
      "0005_path_trash.sql",
      "0016_media_size.sql",
    ]) {
      db.exec(migration(f));
    }
    expect(db.prepare("SELECT width, height FROM media").all()).toEqual([
      { width: null, height: null },
    ]);
    db.exec("UPDATE media SET width = 3000, height = 4000");
    expect(() => db.exec("UPDATE media SET width = 0")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE media SET height = -1")).toThrow(/CHECK/);
  });
});

describe("0010_tag_field.sql", () => {
  const migrateAll = () => {
    const db = migrate([["/a.png", "Real", null, null]]);
    for (const f of [
      "0003_visibility.sql",
      "0004_upload.sql",
      "0005_path_trash.sql",
      "0007_list_indexes.sql",
      "0010_tag_field.sql",
    ]) {
      db.exec(migration(f));
    }
    db.exec("INSERT INTO tag (id, name) VALUES (1, 'フィルム')");
    return db;
  };

  it("leaves existing photos without values", () => {
    const db = migrateAll();
    expect(
      db.prepare("SELECT tag_values, tag_value_visibility FROM media").all(),
    ).toEqual([{ tag_values: null, tag_value_visibility: null }]);
  });

  it("keeps options for select fields only, and labels unique per tag", () => {
    const db = migrateAll();
    const add = (label: string, type: string, options: string | null) =>
      db
        .prepare(
          "INSERT INTO tag_field (tag_id, label, type, options) VALUES (1, ?, ?, ?)",
        )
        .run(label, type, options);
    add("銘柄", "select", '["Portra 400"]');
    add("ISO", "number", null);
    expect(() => add("x", "select", null)).toThrow(/CHECK/);
    expect(() => add("y", "select", "[]")).toThrow(/CHECK/);
    expect(() => add("z", "text", '["a"]')).toThrow(/CHECK/);
    expect(() => add("w", "color", null)).toThrow(/CHECK/);
    expect(() => add("", "text", null)).toThrow(/CHECK/);
    expect(() => add("ISO", "text", null)).toThrow(/UNIQUE/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO tag_field (tag_id, label, type) VALUES (99, 'a', 'text')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    expect(
      db
        .prepare(
          "SELECT visibility, position FROM tag_field WHERE label = 'ISO'",
        )
        .get(),
    ).toEqual({ visibility: "shown", position: 0 });
  });

  it("stores values and levels as JSON objects only", () => {
    const db = migrateAll();
    db.exec(
      `UPDATE media SET tag_values = '{"1":"a"}', tag_value_visibility = '{"1":"hidden"}'`,
    );
    for (const bad of ["'[1]'", "'x'", "'1'"]) {
      expect(() => db.exec(`UPDATE media SET tag_values = ${bad}`)).toThrow(
        /CHECK/,
      );
      expect(() =>
        db.exec(`UPDATE media SET tag_value_visibility = ${bad}`),
      ).toThrow(/CHECK/);
    }
  });
});

describe("0013_media_file.sql", () => {
  const dir = resolve(__dirname, "../../migrations");
  /** Every migration before 0013, then `rows`, then 0013. */
  const migrate13 = (rows = "") => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const names = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of names.filter((f) => f < "0013")) db.exec(migration(f));
    if (rows) db.exec(rows);
    for (const f of names.filter((f) => f >= "0013")) db.exec(migration(f));
    return db;
  };
  const SHA = "a".repeat(64);
  const files = (db: DatabaseSync) =>
    db
      .prepare(
        `SELECT media_id, role, storage, object_key, source_file_id, status,
           upload_id, size, sha256, mime_type, file_exif, metadata_read_at,
           uploaded_at FROM media_file ORDER BY id`,
      )
      .all();
  const raises = (db: DatabaseSync, sql: string, msg: RegExp) =>
    expect(() => db.exec(sql), sql).toThrow(msg);

  it("gives every existing photo its original, copied from media", () => {
    const db = migrate13(`
      INSERT INTO media (file, platform, status, size, sha256, file_exif,
        metadata_read_at, uploaded_at) VALUES
      ('/a/x.png', 'VRChat', 'ready', 10, '${SHA}', '{"make":"A"}',
        '2026-01-01T00:00:00.000Z', '2025-12-31T00:00:00.000Z'),
      ('/a/y.JPG', 'Real', 'uploading', 20, NULL, NULL, NULL, NULL),
      ('/a/z.webp', 'Real', 'ready', NULL, NULL, NULL, NULL, NULL);`);
    expect(files(db)).toEqual([
      {
        media_id: 1,
        role: "original",
        storage: "b2",
        object_key: "/a/x.png",
        source_file_id: null,
        status: "ready",
        upload_id: null,
        size: 10,
        sha256: SHA,
        mime_type: "image/png",
        file_exif: '{"make":"A"}',
        metadata_read_at: "2026-01-01T00:00:00.000Z",
        uploaded_at: "2025-12-31T00:00:00.000Z",
      },
      expect.objectContaining({
        media_id: 2,
        object_key: "/a/y.JPG",
        status: "uploading",
        mime_type: "image/jpeg",
      }),
      expect.objectContaining({ media_id: 3, mime_type: null }),
    ]);
    // No photo shows another file yet.
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM media WHERE active_file_id IS NOT NULL",
        )
        .get(),
    ).toEqual({ c: 0 });
  });

  it("creates a new photo's original in the same statement, and keeps it in step", () => {
    const db = migrate13();
    db.exec(
      `INSERT INTO media (file, platform, status, size, sha256)
       VALUES ('/u/a.jpg', 'Real', 'uploading', 5, '${SHA}')`,
    );
    db.exec("UPDATE media_file SET upload_id = 'mp-1' WHERE media_id = 1");
    expect(files(db)).toEqual([
      expect.objectContaining({
        role: "original",
        object_key: "/u/a.jpg",
        status: "uploading",
        upload_id: "mp-1",
        sha256: SHA,
      }),
    ]);
    db.exec(
      `UPDATE media SET status = 'ready', uploaded_at = '2026-11-20T00:00:00.000Z',
         file_exif = '{"software":"x"}', metadata_read_at = 'reading:t' WHERE id = 1`,
    );
    expect(files(db)).toEqual([
      expect.objectContaining({
        status: "ready",
        // A completed upload has no multipart upload left.
        upload_id: null,
        uploaded_at: "2026-11-20T00:00:00.000Z",
        file_exif: '{"software":"x"}',
        metadata_read_at: "reading:t",
      }),
    ]);
  });

  it("refuses a second original, a duplicate object or hash, and bad values", () => {
    const db = migrate13(
      `INSERT INTO media (file, platform, sha256) VALUES ('/a.png', 'Real', '${SHA}');`,
    );
    raises(
      db,
      "INSERT INTO media_file (media_id, role, object_key) VALUES (1, 'original', '/b.png')",
      /UNIQUE/,
    );
    raises(
      db,
      "INSERT INTO media_file (media_id, role, object_key) VALUES (1, 'edit', '/a.png')",
      /UNIQUE/,
    );
    raises(
      db,
      `INSERT INTO media_file (media_id, role, object_key, sha256) VALUES (1, 'edit', '/b.png', '${SHA}')`,
      /UNIQUE/,
    );
    // The same key in another storage is another object.
    db.exec(
      "INSERT INTO media_file (media_id, role, storage, object_key) VALUES (1, 'edit', 'r2', '/a.png')",
    );
    for (const bad of [
      "(1, 'thumb', 'b2', '/c.png', NULL, 'ready', NULL)",
      "(1, 'edit', 's3', '/c.png', NULL, 'ready', NULL)",

      "(1, 'edit', 'b2', '/c.png', NULL, 'gone', NULL)",
      // A multipart upload id only while uploading.
      "(1, 'edit', 'b2', '/c.png', NULL, 'ready', 'mp')",
      // A display copy, poster or playback copy says what it was made from.
      "(1, 'display', 'b2', '/c.png', NULL, 'ready', NULL)",
      "(1, 'poster', 'b2', '/c.png', NULL, 'ready', NULL)",
      // An original was made from nothing.
      "(1, 'original', 'b2', '/c.png', 1, 'ready', NULL)",
    ]) {
      raises(
        db,
        `INSERT INTO media_file (media_id, role, storage, object_key, source_file_id, status, upload_id) VALUES ${bad}`,
        /CHECK/,
      );
    }
  });

  it("makes files only from files of the same photo", () => {
    const db = migrate13(
      "INSERT INTO media (file, platform) VALUES ('/a.png', 'Real'), ('/b.png', 'Real');",
    );
    // 1, 2: the originals of photos 1 and 2.
    raises(
      db,
      "INSERT INTO media_file (media_id, role, object_key, source_file_id) VALUES (1, 'edit', '/a-e.jpg', 2)",
      /same photo/,
    );
    db.exec(
      "INSERT INTO media_file (media_id, role, object_key, source_file_id, status) VALUES (1, 'edit', '/a-e.jpg', 1, 'ready')",
    );
    raises(
      db,
      "UPDATE media_file SET source_file_id = 2 WHERE id = 3",
      /same photo/,
    );
    // An edit with no recorded source and a display copy made from it
    // cannot move to another photo and leave its copy behind...
    db.exec(`UPDATE media_file SET source_file_id = NULL WHERE id = 3;
      INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status)
        VALUES (4, 1, 'display', '/a-e.d.jpg', 3, 'ready')`);
    raises(
      db,
      "UPDATE media_file SET media_id = 2 WHERE id = 3",
      /made from it/,
    );
    // ... but can once the copy is gone.
    db.exec("DELETE FROM media_file WHERE id = 4");
    db.exec("UPDATE media_file SET media_id = 2 WHERE id = 3");
  });

  it("shows only a ready original or edit of the same photo, whichever is chosen", () => {
    const db = migrate13(
      "INSERT INTO media (file, platform) VALUES ('/a.png', 'Real'), ('/b.png', 'Real');",
    );
    db.exec(`INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status) VALUES
      (10, 1, 'edit', '/a-lr.jpg', 1, 'ready'),
      (11, 1, 'edit', '/a-on1.png', 1, 'ready'),
      (12, 1, 'edit', '/a-wip.png', 1, 'uploading'),
      (13, 1, 'display', '/a-d.jpg', 10, 'ready'),
      (14, 2, 'edit', '/b-lr.jpg', 2, 'ready')`);
    // Any ready edit, or the original itself.
    for (const id of [10, 11, 1, 10]) {
      db.exec(`UPDATE media SET active_file_id = ${id} WHERE id = 1`);
    }
    for (const id of [12, 13, 14, 2, 999]) {
      raises(
        db,
        `UPDATE media SET active_file_id = ${id} WHERE id = 1`,
        /active_file_id/,
      );
    }
    raises(
      db,
      "INSERT INTO media (file, platform, active_file_id) VALUES ('/c.png', 'Real', 10)",
      /active_file_id/,
    );
    // The shown file stays a ready original or edit of the photo...
    raises(
      db,
      "UPDATE media_file SET status = 'failed' WHERE id = 10",
      /shows/,
    );
    raises(db, "UPDATE media_file SET role = 'display' WHERE id = 10", /shows/);
    raises(
      db,
      "UPDATE media_file SET media_id = 2, source_file_id = 2 WHERE id = 10",
      // (its display copy 13 would be left behind, too)
      /shows|made from it/,
    );
    // ... and cannot be deleted while shown, but other files can.
    raises(db, "DELETE FROM media_file WHERE id = 10", /FOREIGN KEY/);
    db.exec("UPDATE media_file SET status = 'failed' WHERE id = 11");
    db.exec("UPDATE media SET active_file_id = NULL WHERE id = 1");
    db.exec("DELETE FROM media_file WHERE id = 13");
    db.exec("DELETE FROM media_file WHERE id = 10");
  });

  it("deletes a photo's files with it, the shown one and copies included", () => {
    const db = migrate13(
      "INSERT INTO media (file, platform) VALUES ('/a.png', 'Real'), ('/b.png', 'Real');",
    );
    db.exec(`INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status) VALUES
      (10, 1, 'edit', '/a-lr.jpg', 1, 'ready'),
      (11, 1, 'display', '/a-d.jpg', 10, 'ready')`);
    db.exec("UPDATE media SET active_file_id = 10 WHERE id = 1");
    db.exec("DELETE FROM media WHERE id = 1");
    expect(
      db.prepare("SELECT media_id, object_key FROM media_file").all(),
    ).toEqual([{ media_id: 2, object_key: "/b.png" }]);
  });

  it("keeps the earlier triggers and indexes", () => {
    const db = migrate13();
    const names = (type: string) =>
      (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = ? ORDER BY name",
          )
          .all(type) as { name: string }[]
      ).map((r) => r.name);
    expect(names("trigger")).toEqual(
      expect.arrayContaining([
        "media_public_id_default",
        "media_public_id_fixed",
        "media_path_default",
        "media_file_original_insert",
        "media_file_original_sync",
        "media_active_file_insert",
        "media_active_file_update",
        "media_file_active_guard",
        "media_file_source_insert",
        "media_file_source_update",
        "media_file_source_moved",
      ]),
    );
    expect(names("index")).toEqual(
      expect.arrayContaining([
        "idx_media_public_id",
        "idx_media_sha256",
        "idx_media_path_live",
        "idx_media_live_timestamp",
        "idx_media_uploading",
        "idx_media_trashed",
        "idx_media_metadata_read_at",
        "idx_media_digitized_with",
        "idx_media_file_original",
        "idx_media_file_media",
        "idx_media_file_source",
        "idx_media_file_sha256",
        "idx_media_file_edit_read",
        "idx_media_active_file",
      ]),
    );
    // A row inserted without a public id or path still gets both.
    db.exec("INSERT INTO media (file, platform) VALUES ('/n.png', 'Real')");
    const row = db.prepare("SELECT public_id, path FROM media").get() as {
      public_id: string;
      path: string;
    };
    expect(row.public_id).toMatch(PUBLIC_ID_RE);
    expect(row.path).toBe("/n.png");
  });
});

describe("0014_platform.sql", () => {
  const files = readdirSync(resolve(__dirname, "../../migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  /** Indexes and triggers on media, as SQL. */
  const schema = (db: DatabaseSync) =>
    Object.fromEntries(
      (
        db
          .prepare(
            "SELECT name, sql FROM sqlite_master WHERE tbl_name = 'media' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY name",
          )
          .all() as { name: string; sql: string }[]
      ).map((r) => [r.name, r.sql]),
    );
  /** Every migration before 0014, these rows, then 0014. */
  const migrate14 = (insert: string) => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const f of files.filter((f) => f < "0014")) db.exec(migration(f));
    db.exec(insert);
    const rows = db.prepare("SELECT * FROM media ORDER BY id").all();
    const before = schema(db);
    db.exec(migration("0014_platform.sql"));
    return { db, rows, before };
  };
  const ROWS = `INSERT INTO media (id, file, platform, visibility, timestamp, tags) VALUES
    (1, '/2022/neos.png', 'Real', 'public', '2022-05-01T10:00:00+09:00', '["a"]'),
    (2, '/VRChat/v.png', 'VRChat', 'private', '2023-12-01T00:00:00+09:00', '[]'),
    (3, '/r.jpg', 'Real', 'unlisted', NULL, '[]');
    UPDATE media SET trashed_at = '2026-01-01T00:00:00Z' WHERE id = 3;`;

  it("keeps every row, public id and value", () => {
    const { db, rows } = migrate14(ROWS);
    expect(rows).toHaveLength(3);
    expect(db.prepare("SELECT * FROM media ORDER BY id").all()).toEqual(rows);
  });

  it("seeds Real and VRChat", () => {
    const { db } = migrate14(ROWS);
    expect(
      db.prepare("SELECT key, name, kind, position FROM platform").all(),
    ).toEqual([
      { key: "Real", name: "Real", kind: "real", position: 0 },
      { key: "VRChat", name: "VRChat", kind: "virtual", position: 1 },
    ]);
  });

  it("keeps the indexes and triggers exactly, and adds the NOT NULL ones", () => {
    const { db, before } = migrate14(ROWS);
    const after = schema(db);
    expect(Object.keys(after).sort()).toEqual(
      [
        ...Object.keys(before),
        "media_platform_required_insert",
        "media_platform_required_update",
      ].sort(),
    );
    for (const [name, sql] of Object.entries(before)) {
      expect(after[name], name).toBe(sql);
    }
  });

  it("takes any platform in the table, and only those", () => {
    const { db } = migrate14(ROWS);
    expect(() =>
      db.exec("INSERT INTO media (file, platform) VALUES ('/m.png', 'Mars')"),
    ).toThrow(/FOREIGN KEY/);
    expect(() => db.exec("INSERT INTO media (file) VALUES ('/m.png')")).toThrow(
      /NOT NULL/,
    );
    expect(() =>
      db.exec("UPDATE media SET platform = NULL WHERE id = 1"),
    ).toThrow(/NOT NULL/);
    db.exec(
      "INSERT INTO platform (key, name, kind, position) VALUES ('Neos-VR', 'Neos VR', 'virtual', 2)",
    );
    db.exec("UPDATE media SET platform = 'Neos-VR' WHERE id = 1");
    // The triggers of 0003 and 0005 still work.
    db.exec("INSERT INTO media (file, platform) VALUES ('/n.png', 'Neos-VR')");
    expect(
      db
        .prepare(
          "SELECT path, length(public_id) AS n FROM media WHERE file = '/n.png'",
        )
        .get(),
    ).toEqual({ path: "/n.png", n: 10 });
    expect(() =>
      db.exec("UPDATE media SET public_id = 'zzzzzzzzzz' WHERE id = 1"),
    ).toThrow(/cannot be changed/);
    // In use: not deleted.
    expect(() => db.exec("DELETE FROM platform WHERE key = 'Neos-VR'")).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("refuses malformed keys, names and kinds", () => {
    const { db } = migrate14("");
    for (const [key, name, kind] of [
      ["Neos VR", "a", "virtual"],
      ["-x", "b", "virtual"],
      ["ok", " c", "virtual"],
      ["ok", "", "virtual"],
      ["ok", "d", "space"],
    ]) {
      expect(
        () =>
          db
            .prepare(
              "INSERT INTO platform (key, name, kind, position) VALUES (?, ?, ?, 9)",
            )
            .run(key, name, kind),
        `${key} ${name} ${kind}`,
      ).toThrow(/CHECK/);
    }
    expect(() =>
      db.exec(
        "INSERT INTO platform (key, name, kind, position) VALUES ('v2', 'vrchat', 'virtual', 9)",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("keeps a filtered list on idx_media_live_timestamp", () => {
    const { db } = migrate14(ROWS);
    const plan = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT id FROM media
           WHERE status = 'ready' AND trashed_at IS NULL AND platform = ?
           ORDER BY timestamp DESC, id DESC LIMIT 50`,
        )
        .all("VRChat") as { detail: string }[]
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toContain("idx_media_live_timestamp");
    expect(plan).not.toContain("TEMP B-TREE");
  });
});

describe("0015_photographer_vrcx.sql", () => {
  const files = readdirSync(resolve(__dirname, "../../migrations"))
    .filter((f) => f.endsWith(".sql") && f !== "0015_photographer_vrcx.sql")
    .sort();
  /** Every table's indexes and triggers, as SQL. */
  const schema = (db: DatabaseSync) =>
    db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY name",
      )
      .all();
  /**
   * The other migrations (applied before it in production: 0015 runs after
   * 0016 there), a VRChat photo with the misread author, then 0015.
   */
  const migrate15 = () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const f of files) db.exec(migration(f));
    db.exec(`INSERT INTO media (id, file, platform, world_id, world_author_id)
      VALUES (1, '/v.png', 'VRChat', 'wrld_a', 'usr_x')`);
    const before = schema(db);
    db.exec(migration("0015_photographer_vrcx.sql"));
    return { db, before };
  };

  it("renames the misread world author to the photographer, keeping values", () => {
    const { db } = migrate15();
    expect(
      db
        .prepare(
          "SELECT world_id, photographer_id, photographer_name, vrcx FROM media",
        )
        .all(),
    ).toEqual([
      {
        world_id: "wrld_a",
        photographer_id: "usr_x",
        photographer_name: null,
        vrcx: null,
      },
    ]);
    expect(() => db.prepare("SELECT world_author_id FROM media").all()).toThrow(
      /no such column/,
    );
  });

  it("keeps 0013's triggers, 0014's platform key and every index", () => {
    const { db, before } = migrate15();
    expect(schema(db)).toEqual(before);
    // 0014: the platform must be a platform row's key.
    expect(() =>
      db.exec("INSERT INTO media (file, platform) VALUES ('/n.png', 'Nope')"),
    ).toThrow(/FOREIGN KEY/);
    // 0013: a new photo gets its original's media_file row.
    db.exec("INSERT INTO media (file, platform) VALUES ('/r.png', 'Real')");
    expect(
      db
        .prepare(
          "SELECT role, object_key FROM media_file WHERE object_key = '/r.png'",
        )
        .all(),
    ).toEqual([{ role: "original", object_key: "/r.png" }]);
  });

  it("keeps media.vrcx a JSON object", () => {
    const { db } = migrate15();
    db.exec(`UPDATE media SET vrcx = '{"instance_id":null,"players":[]}'`);
    for (const bad of ["'nope'", "'[1]'"]) {
      expect(() => db.exec(`UPDATE media SET vrcx = ${bad}`), bad).toThrow(
        /CHECK/,
      );
    }
  });
});

describe("0019_camera_image_media.sql", () => {
  const dir = resolve(__dirname, "../../migrations");
  /** Every migration before 0019, then `rows`, then the rest. */
  const migrate19 = (rows: string) => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const names = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of names.filter((f) => f < "0019")) db.exec(migration(f));
    db.exec(rows);
    for (const f of names.filter((f) => f >= "0019")) db.exec(migration(f));
    return db;
  };
  const ROWS = `
    INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A'), (2, 'b', 'B');
    INSERT INTO media (id, file, platform, visibility) VALUES
      (1, '/r/p.png', 'Real', 'public'), (2, '/r/q.png', 'Real', 'private');
    INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status)
      SELECT 100, 1, 'edit', '/r/p_edit.jpg', id, 'ready' FROM media_file
      WHERE media_id = 1 AND role = 'original';
    INSERT INTO camera_image (id, camera_id, file, position, caption) VALUES
      (1, 1, '/camera/a/front.png', 0, 'Front'),
      (2, 1, '/r/p.png', 1, 'Photo'),
      -- Another file of the same photo: one picture per camera and photo.
      (3, 1, '/r/p_edit.jpg', 2, NULL),
      (4, 2, '/r/q.png', 0, NULL),
      (5, 2, '/camera/a/front.png', 1, NULL);`;

  it("turns pictures that are a photo's file into references to the photo", () => {
    const db = migrate19(ROWS);
    expect(
      db
        .prepare(
          "SELECT id, camera_id, file, media_id, position, caption FROM camera_image ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: 1,
        camera_id: 1,
        file: "/camera/a/front.png",
        media_id: null,
        position: 0,
        caption: "Front",
      },
      {
        id: 2,
        camera_id: 1,
        file: null,
        media_id: 1,
        position: 1,
        caption: "Photo",
      },
      {
        id: 4,
        camera_id: 2,
        file: null,
        media_id: 2,
        position: 0,
        caption: null,
      },
      {
        id: 5,
        camera_id: 2,
        file: "/camera/a/front.png",
        media_id: null,
        position: 1,
        caption: null,
      },
    ]);
    // Their API answers changed: a new content version, and only then.
    const version = (d: DatabaseSync) =>
      d
        .prepare("SELECT value FROM setting WHERE key = 'content_version'")
        .get();
    expect(version(db)).toEqual({
      value: expect.stringMatching(/^"[0-9a-f]{24}"$/),
    });
    expect(
      version(
        migrate19(
          "INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A'); INSERT INTO camera_image (camera_id, file) VALUES (1, '/camera/a/x.png');",
        ),
      ),
    ).toBeUndefined();
    // New rows continue after the old ids.
    db.exec(
      "INSERT INTO camera_image (camera_id, file) VALUES (1, '/camera/a/n.png')",
    );
    expect(db.prepare("SELECT MAX(id) AS id FROM camera_image").get()).toEqual({
      id: 6,
    });
  });

  it("keeps a picture's file and a photo's files apart from now on", () => {
    const db = migrate19(ROWS);
    const raises = (sql: string, msg: RegExp) =>
      expect(() => db.exec(sql), sql).toThrow(msg);
    // Exactly one of file and media_id.
    raises(
      "INSERT INTO camera_image (camera_id, file, media_id) VALUES (1, '/camera/a/x.png', 2)",
      /CHECK/,
    );
    raises("INSERT INTO camera_image (camera_id) VALUES (1)", /CHECK/);
    raises(
      "INSERT INTO camera_image (camera_id, media_id) VALUES (1, 1)",
      /UNIQUE/,
    );
    // A photo's file is no picture's own, and the other way round.
    raises(
      "INSERT INTO camera_image (camera_id, file) VALUES (2, '/r/p_edit.jpg')",
      /photo's file/,
    );
    raises(
      "UPDATE camera_image SET file = '/r/p.png' WHERE id = 1",
      /photo's file/,
    );
    raises(
      "INSERT INTO media (file, platform) VALUES ('/camera/a/front.png', 'Real')",
      /camera picture's file/,
    );
    raises(
      "UPDATE media_file SET object_key = '/camera/a/front.png' WHERE id = 100",
      /camera picture's file/,
    );
    // Deleting a photo for good takes its pictures with it.
    db.exec("DELETE FROM media WHERE id = 2");
    expect(
      db.prepare("SELECT id FROM camera_image WHERE camera_id = 2").all(),
    ).toEqual([{ id: 5 }]);
  });
});

describe("0021_tag_visibility.sql", () => {
  const dir = resolve(__dirname, "../../migrations");
  /** Every migration before 0021, then `rows`, then the rest. */
  const migrate21 = (rows: string) => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const names = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of names.filter((f) => f < "0021")) db.exec(migration(f));
    db.exec(rows);
    for (const f of names.filter((f) => f >= "0021")) db.exec(migration(f));
    return db;
  };
  // film, VRChat and night are public, secret private, gone has no row.
  // Camera 1 passes on film and keeps night to itself.
  const ROWS = `
    INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A');
    INSERT INTO camera_tag (camera_id, tag, propagate, position) VALUES
      (1, 'film', 1, 0), (1, 'night', 0, 1);
    INSERT INTO tag (name, public) VALUES
      ('film', 1), ('VRChat', 1), ('secret', 0), ('night', 1);
    INSERT INTO media (id, file, platform, visibility, tags, camera_id, metadata_visibility) VALUES
      -- Follows the site: nothing to choose.
      (1, '/a.png', 'Real', 'public', '["VRChat"]', 1, NULL),
      -- Its tags hidden: every tag it has, its camera's too.
      (2, '/b.png', 'Real', 'public', '["VRChat","secret","gone"]', 1,
       '{"tags":"hidden","camera":"hidden"}'),
      -- Any value but public hid them.
      (3, '/c.png', 'Real', 'public', '["VRChat"]', NULL, '{"tags":"nope"}'),
      -- Public by its own level.
      (4, '/d.png', 'Real', 'public', '["VRChat"]', NULL, '{"tags":"public"}'),
      -- Hidden, but no tags at all.
      (5, '/e.png', 'Real', 'public', '[]', NULL, '{"tags":"hidden"}'),
      -- A JSON null follows the site.
      (6, '/f.png', 'Real', 'public', '["VRChat"]', NULL, '{"tags":null}');`;

  const rows = (db: DatabaseSync) =>
    db
      .prepare(
        "SELECT id, metadata_visibility, tag_visibility FROM media ORDER BY id",
      )
      .all() as {
      id: number;
      metadata_visibility: string | null;
      tag_visibility: string | null;
    }[];

  it("hides every tag of a photo whose tags level hid them, and drops the level", () => {
    const db = migrate21(ROWS);
    expect(rows(db)).toEqual([
      { id: 1, metadata_visibility: null, tag_visibility: null },
      {
        id: 2,
        metadata_visibility: '{"camera":"hidden"}',
        tag_visibility: expect.any(String),
      },
      {
        id: 3,
        metadata_visibility: null,
        tag_visibility: '{"VRChat":"hidden"}',
      },
      { id: 4, metadata_visibility: null, tag_visibility: null },
      { id: 5, metadata_visibility: null, tag_visibility: null },
      { id: 6, metadata_visibility: null, tag_visibility: null },
    ]);
    expect(JSON.parse(rows(db)[1].tag_visibility ?? "")).toEqual({
      VRChat: "hidden",
      secret: "hidden",
      gone: "hidden",
      film: "hidden",
    });
    const site = db
      .prepare("SELECT value FROM setting WHERE key = 'metadata_visibility'")
      .get() as { value: string };
    expect(JSON.parse(site.value)).not.toHaveProperty("tags");
    expect(JSON.parse(site.value)).toHaveProperty("camera", "model");
  });

  it("follows a site default that hid tags, for photos without their own", () => {
    const db = migrate21(`${ROWS}
      UPDATE setting SET value = json_set(value, '$.tags', 'hidden')
      WHERE key = 'metadata_visibility';`);
    const tv = Object.fromEntries(
      rows(db).map((r) => [
        r.id,
        r.tag_visibility === null ? null : JSON.parse(r.tag_visibility),
      ]),
    );
    expect(tv[1]).toEqual({ VRChat: "hidden", film: "hidden" });
    // Its own public level won over the site.
    expect(tv[4]).toBeNull();
    expect(tv[6]).toEqual({ VRChat: "hidden" });
  });

  it("shows no tag that was hidden before, even once every tag is public", () => {
    for (const site of ["public", "hidden"]) {
      const db = migrate21(`${ROWS}
        UPDATE setting SET value = json_set(value, '$.tags', '${site}')
        WHERE key = 'metadata_visibility';`);
      const pub = new Set(
        (
          db.prepare("SELECT name FROM tag WHERE public = 1").all() as {
            name: string;
          }[]
        ).map((t) => t.name),
      );
      // What the public site showed before (the tags level, then public
      // tags only).
      const before: Record<number, string[]> = {
        1: site === "public" ? ["VRChat", "film"] : [],
        2: [],
        3: [],
        4: ["VRChat"],
        5: [],
        6: site === "public" ? ["VRChat"] : [],
      };
      const media = db
        .prepare(
          "SELECT id, tags, camera_id, tag_visibility FROM media ORDER BY id",
        )
        .all() as {
        id: number;
        tags: string;
        camera_id: number | null;
        tag_visibility: string | null;
      }[];
      for (const r of media) {
        const all = effectiveTags(
          JSON.parse(r.tags) as string[],
          r.camera_id === 1 ? ["film"] : [],
        );
        const choices = parseTagVisibility(r.tag_visibility);
        expect(
          all.filter((t) => tagShown(t, choices, pub)),
          `${site} ${r.id}`,
        ).toEqual(before[r.id]);
        if (before[r.id].length === 0) {
          expect(
            all.filter((t) => tagShown(t, choices, new Set(all))),
            `${site} ${r.id}, every tag public`,
          ).toEqual([]);
        }
      }
    }
  });

  it("removes the level from upload rules, keeping their order and the rest", () => {
    const db = migrate21(`${ROWS}
      INSERT INTO setting (key, value) VALUES ('upload_rules', json('[
        {"id":"a","actions":{"metadata":{"tags":"hidden","camera":"hidden"}}},
        {"id":"b","actions":{"tags":["x"]}},
        {"id":"c","actions":{"metadata":{"tags":"public"}}}
      ]'));`);
    const v = db
      .prepare("SELECT value FROM setting WHERE key = 'upload_rules'")
      .get() as { value: string };
    expect(JSON.parse(v.value)).toEqual([
      { id: "a", actions: { metadata: { camera: "hidden" } } },
      { id: "b", actions: { tags: ["x"] } },
      { id: "c", actions: { metadata: {} } },
    ]);
  });

  it("takes only a JSON object", () => {
    const db = migrate21(ROWS);
    db.exec(`UPDATE media SET tag_visibility = '{"a":"shown"}' WHERE id = 1`);
    for (const bad of ["'nope'", `'["a"]'`, "'1'"]) {
      expect(
        () => db.exec(`UPDATE media SET tag_visibility = ${bad} WHERE id = 1`),
        bad,
      ).toThrow(/CHECK/);
    }
  });
});
