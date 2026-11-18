// Runs the queries against the admin's real migrations in an in-memory
// SQLite (node:sqlite) through a minimal D1 stand-in, so the visibility
// rules are checked on the actual SQL.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  getCamera,
  getFileAccess,
  getLegacyId,
  getMedia,
  getPhotoForImage,
  listCameras,
  listPublicMedia,
  rowToItem,
} from "./query";

const migrationsDir = resolve(__dirname, "../../../admin/migrations");

/** The D1 subset query.ts uses, backed by node:sqlite. */
const d1 = (db: DatabaseSync): D1Database => {
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { all: () => Promise<unknown> }[]) =>
      Promise.all(stmts.map((s) => s.all())),
  } as unknown as D1Database;
};

const setup = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, f), "utf8"));
  }
  db.exec(`
    INSERT INTO camera (id, slug, name, manufacturer, manufacturer_url, model, kind, product_url) VALUES
      (1, 'virtuallens2', 'VirtualLens2', 'logilabo', 'https://example.com/logilabo', 'VirtualLens2', 'virtual', 'https://example.com/vl2'),
      (2, 'pentax-sp', 'PENTAX SP', NULL, NULL, NULL, 'film', NULL),
      (3, 'a-unlisted', 'Unlisted cam', NULL, NULL, 'U', NULL, NULL),
      (4, 'b-public', 'Public cam', 'B', NULL, 'P', 'digital', NULL);
    INSERT INTO camera_image (camera_id, file, position, caption) VALUES
      (1, '/c/b.png', 1, NULL),
      (1, '/c/a.png', 0, 'Front');
    -- Cameras: 1 and 4 have public photos, 3 only an unlisted one, 2 only a
    -- private one.
    INSERT INTO media (id, public_id, file, platform, timestamp, camera_id, tags, visibility, legacy_index) VALUES
      (1, 'aaaaaaaaa2', '/p1.png', 'Real',   '2023-12-01T00:00:00Z', 4,    '["film"]',   'public',   0),
      (2, 'aaaaaaaaa3', '/p2.png', 'VRChat', '2023-12-02T00:00:00Z', 1,    '["VRChat"]', 'public',   1),
      (3, 'aaaaaaaaa4', '/u.png',  'VRChat', '2023-12-03T00:00:00Z', 3,    '[]',         'unlisted', 2),
      (4, 'aaaaaaaaa5', '/x.png',  'Real',   '2023-12-04T00:00:00Z', 2,    '[]',         'private',  3),
      (5, 'aaaaaaaaa6', '/n.png',  'Real',   NULL,                   NULL, '[]',         'public',   NULL),
      (6, 'aaaaaaaaa7', '/p3.png', 'Real',   '2023-12-01T00:00:00Z', NULL, '[]',         'public',   NULL);
    -- Public and unlisted, but their uploads have not completed: never
    -- served, and they do not make camera 2 visible either.
    INSERT INTO media (id, public_id, file, platform, timestamp, camera_id, tags, visibility, legacy_index, status) VALUES
      (7, 'aaaaaaaaa8', '/up.png', 'Real', '2023-12-09T00:00:00Z', 2, '[]', 'public',   4, 'uploading'),
      (8, 'aaaaaaaaa9', '/uu.png', 'Real', '2023-12-09T00:00:00Z', 2, '[]', 'unlisted', 5, 'uploading');
    INSERT INTO camera_image (camera_id, file, position) VALUES (3, '/up.png', 9);
    -- File names are public except photo 6's.
    UPDATE media SET filename_public = 1 WHERE id <> 6;
  `);
  return d1(db);
};

describe("listPublicMedia", () => {
  it("returns public photos only, newest first and undated last", async () => {
    const items = await listPublicMedia(setup());
    // Rows 6 and 1 share a timestamp: the higher id first.
    expect(items.map((m) => m.id)).toEqual([
      "aaaaaaaaa3",
      "aaaaaaaaa7",
      "aaaaaaaaa2",
      "aaaaaaaaa6",
    ]);
    expect(items[0]).toEqual({
      id: "aaaaaaaaa3",
      file: "/p2.png",
      platform: "VRChat",
      // Deprecated alias, still sent during the rename.
      world: "VRChat",
      timestamp: "2023-12-02T00:00:00Z",
      camera: {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        model: "VirtualLens2",
      },
      tags: ["VRChat"],
    });
  });
});

describe("getMedia", () => {
  it("returns public and unlisted photos", async () => {
    const db = setup();
    expect((await getMedia(db, "aaaaaaaaa2"))?.file).toBe("/p1.png");
    expect((await getMedia(db, "aaaaaaaaa4"))?.file).toBe("/u.png");
  });

  it("hides private and unknown photos", async () => {
    const db = setup();
    expect(await getMedia(db, "aaaaaaaaa5")).toBeNull();
    expect(await getMedia(db, "zzzzzzzzzz")).toBeNull();
  });
});

describe("getFileAccess", () => {
  it("allows public photos (with metadata) and camera pictures", async () => {
    const db = setup();
    const p = await getFileAccess(db, "/p1.png");
    expect(p?.kind === "photo" && p.photo.id).toBe("aaaaaaaaa2");
    expect(await getFileAccess(db, "/c/a.png")).toEqual({
      kind: "camera-image",
    });
  });

  it("refuses unlisted, private and unknown files", async () => {
    const db = setup();
    // A private photo also listed as a camera picture stays private.
    await db
      .prepare(
        "INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/x.png', 5)",
      )
      .all();
    expect(await getFileAccess(db, "/x.png")).toBeNull();
    expect(await getFileAccess(db, "/u.png")).toBeNull();
    expect(await getFileAccess(db, "/x.png")).toBeNull();
    expect(await getFileAccess(db, "/none.png")).toBeNull();
  });
});

describe("getLegacyId", () => {
  it("maps old indices of public and unlisted photos", async () => {
    const db = setup();
    expect(await getLegacyId(db, 0)).toBe("aaaaaaaaa2");
    expect(await getLegacyId(db, 2)).toBe("aaaaaaaaa4");
    expect(await getLegacyId(db, 3)).toBeNull(); // private
    expect(await getLegacyId(db, 9)).toBeNull();
  });
});

describe("cameras", () => {
  it("lists cameras of public photos by slug, images in order", async () => {
    const cameras = await listCameras(setup());
    expect(cameras.map((c) => c.slug)).toEqual(["b-public", "virtuallens2"]);
    expect(cameras[1]).toEqual({
      slug: "virtuallens2",
      name: "VirtualLens2",
      manufacturer: "logilabo",
      manufacturerUrl: "https://example.com/logilabo",
      model: "VirtualLens2",
      kind: "virtual",
      description: null,
      productUrl: "https://example.com/vl2",
      images: [
        { file: "/c/a.png", caption: "Front" },
        { file: "/c/b.png", caption: null },
      ],
    });
    expect(cameras[0].images).toEqual([]);
  });

  it("gets a camera of a public or unlisted photo by slug", async () => {
    const db = setup();
    expect((await getCamera(db, "virtuallens2"))?.images).toHaveLength(2);
    expect((await getCamera(db, "b-public"))?.images).toEqual([]);
    expect((await getCamera(db, "a-unlisted"))?.manufacturer).toBeNull();
    expect(await getCamera(db, "nope")).toBeNull();
  });

  it("hides a camera used only for private photos", async () => {
    expect(await getCamera(setup(), "pentax-sp")).toBeNull();
  });
});

describe("a photo whose file name is not public", () => {
  it("is listed and opened without its file", async () => {
    const db = setup();
    const listed = (await listPublicMedia(db)).find((m) => m.id === "aaaaaaaaa7");
    expect(listed).toMatchObject({ id: "aaaaaaaaa7", file: null });
    expect(JSON.stringify(listed)).not.toContain("p3");
    expect((await getMedia(db, "aaaaaaaaa7"))?.file).toBeNull();
  });

  it("is not served by its bucket path", async () => {
    expect(await getFileAccess(setup(), "/p3.png")).toBeNull();
  });

  it("gives its file to the image Worker only (RPC)", async () => {
    const db = setup();
    expect((await getPhotoForImage(db, "aaaaaaaaa7"))?.file).toBe("/p3.png");
    // Still not private ones.
    expect(await getPhotoForImage(db, "aaaaaaaaa5")).toBeNull();
    expect((await getPhotoForImage(db, "aaaaaaaaa4"))?.file).toBe("/u.png");
  });
});

describe("photos in the admin's trash", () => {
  const trash = async (db: D1Database) =>
    db
      .prepare(
        "UPDATE media SET trashed_at = '2026-11-18T00:00:00Z' WHERE id IN (1, 2, 3)",
      )
      .all();

  it("are not listed, opened, served by path or mapped from old URLs", async () => {
    const db = setup();
    await trash(db);
    const listed = (await listPublicMedia(db)).map((m) => m.file);
    expect(listed).not.toContain("/p1.png");
    expect(listed).not.toContain("/p2.png");
    expect(await getMedia(db, "aaaaaaaaa2")).toBeNull();
    expect(await getMedia(db, "aaaaaaaaa4")).toBeNull(); // unlisted
    expect(await getFileAccess(db, "/p1.png")).toBeNull();
    expect(await getLegacyId(db, 0)).toBeNull();
    expect(await getLegacyId(db, 2)).toBeNull();
  });

  it("do not make their camera visible", async () => {
    const db = setup();
    await trash(db);
    // Cameras 4 (row 1), 1 (row 2) and 3 (row 3) had only these photos.
    expect(await listCameras(db)).toEqual([]);
    expect(await getCamera(db, "a-unlisted")).toBeNull();
  });
});

describe("uploads that have not completed", () => {
  it("are not listed, opened, served by path or mapped from old URLs", async () => {
    const db = setup();
    expect((await listPublicMedia(db)).map((m) => m.file)).not.toContain(
      "/up.png",
    );
    expect(await getMedia(db, "aaaaaaaaa8")).toBeNull();
    expect(await getMedia(db, "aaaaaaaaa9")).toBeNull();
    // Also listed as a camera picture: still hidden.
    expect(await getFileAccess(db, "/up.png")).toBeNull();
    expect(await getLegacyId(db, 4)).toBeNull();
    expect(await getLegacyId(db, 5)).toBeNull();
  });

  it("do not make their camera visible", async () => {
    const db = setup();
    expect((await listCameras(db)).map((c) => c.slug)).not.toContain(
      "pentax-sp",
    );
    expect(await getCamera(db, "pentax-sp")).toBeNull();
  });

  it("are served once ready", async () => {
    const db = setup();
    await db.prepare("UPDATE media SET status = 'ready'").all();
    expect((await getMedia(db, "aaaaaaaaa8"))?.file).toBe("/up.png");
    expect((await getFileAccess(db, "/up.png"))?.kind).toBe("photo");
    expect(await getLegacyId(db, 5)).toBe("aaaaaaaaa9");
    expect((await getCamera(db, "pentax-sp"))?.slug).toBe("pentax-sp");
  });
});

describe("rowToItem", () => {
  const row = {
    public_id: "abcdefghjk",
    file: "/a.png",
    filename_public: 1,
    platform: "Real",
    timestamp: null,
    tags: "[]",
    camera_slug: null,
    camera_name: null,
    camera_manufacturer: null,
    camera_model: null,
  };

  it("leaves the file out unless its name is public", () => {
    expect(rowToItem(row).file).toBe("/a.png");
    expect(rowToItem({ ...row, filename_public: 0 }).file).toBeNull();
    expect(rowToItem({ ...row, filename_public: 0 }, true).file).toBe("/a.png");
  });

  it("has no camera when the photo has none", () => {
    expect(rowToItem(row).camera).toBeNull();
  });

  it("keeps a camera without manufacturer or model", () => {
    expect(
      rowToItem({ ...row, camera_slug: "pentax-sp", camera_name: "PENTAX SP" })
        .camera,
    ).toEqual({
      slug: "pentax-sp",
      name: "PENTAX SP",
      manufacturer: null,
      model: null,
    });
  });

  it("drops malformed tags", () => {
    expect(rowToItem({ ...row, tags: "nope" }).tags).toEqual([]);
    expect(rowToItem({ ...row, tags: '["a", 1]' }).tags).toEqual(["a"]);
  });
});
