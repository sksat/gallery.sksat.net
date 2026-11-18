// Runs the queries against the admin's real migrations in an in-memory
// SQLite (node:sqlite) through a minimal D1 stand-in, so the visibility
// rules are checked on the actual SQL.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  getCamera,
  getPathAccess,
  getMedia,
  getPhotoForImage,
  listCameras,
  listPublicMedia,
  projectPhoto,
  type MediaJoinRow,
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
    INSERT INTO media (id, public_id, file, platform, timestamp, camera_id, tags, visibility) VALUES
      (1, 'aaaaaaaaa2', '/p1.png', 'Real',   '2023-12-01T00:00:00Z', 4,    '["film"]',   'public'),
      (2, 'aaaaaaaaa3', '/p2.png', 'VRChat', '2023-12-02T00:00:00Z', 1,    '["VRChat", "secret"]', 'public'),
      (3, 'aaaaaaaaa4', '/u.png',  'VRChat', '2023-12-03T00:00:00Z', 3,    '[]',         'unlisted'),
      (4, 'aaaaaaaaa5', '/x.png',  'Real',   '2023-12-04T00:00:00Z', 2,    '[]',         'private'),
      (5, 'aaaaaaaaa6', '/n.png',  'Real',   NULL,                   NULL, '[]',         'public'),
      (6, 'aaaaaaaaa7', '/p3.png', 'Real',   '2023-12-01T00:00:00Z', NULL, '[]',         'public');
    -- Public and unlisted, but their uploads have not completed: never
    -- served, and they do not make camera 2 visible either.
    INSERT INTO media (id, public_id, file, platform, timestamp, camera_id, tags, visibility, status) VALUES
      (7, 'aaaaaaaaa8', '/up.png', 'Real', '2023-12-09T00:00:00Z', 2, '[]', 'public',   'uploading'),
      (8, 'aaaaaaaaa9', '/uu.png', 'Real', '2023-12-09T00:00:00Z', 2, '[]', 'unlisted', 'uploading');
    INSERT INTO camera_image (camera_id, file, position) VALUES (3, '/up.png', 9);
    -- Tags: "secret" is private.
    INSERT INTO tag (name, public) VALUES ('film', 1), ('VRChat', 1), ('secret', 0);
    -- File names (hidden by default) are public with their folder, except
    -- photo 6's.
    UPDATE media SET metadata_visibility = '{"file_name":"path"}' WHERE id <> 6;
  `);
  return { raw: db, db: d1(db) };
};

const run = (raw: DatabaseSync, sql: string) => raw.exec(sql);

describe("listPublicMedia", () => {
  it("returns public photos only, newest first and undated last", async () => {
    const items = await listPublicMedia(setup().db);
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
      path: "/p2.png",
      name: "p2.png",
      platform: "VRChat",
      timestamp: "2023-12-02T00:00:00Z",
      timestamp_precision: "second",
      camera: {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        model: "VirtualLens2",
      },
      location: null,
      world: null,
      exif: null,
      // "secret" is not a public tag.
      tags: ["VRChat"],
    });
  });
});

describe("getMedia", () => {
  it("returns public and unlisted photos", async () => {
    const { db } = setup();
    expect((await getMedia(db, "aaaaaaaaa2"))?.file).toBe("/p1.png");
    expect((await getMedia(db, "aaaaaaaaa4"))?.file).toBe("/u.png");
  });

  it("hides private and unknown photos", async () => {
    const { db } = setup();
    expect(await getMedia(db, "aaaaaaaaa5")).toBeNull();
    expect(await getMedia(db, "zzzzzzzzzz")).toBeNull();
  });
});

describe("getPathAccess", () => {
  it("allows public photos (with metadata) and camera pictures", async () => {
    const { db } = setup();
    const p = await getPathAccess(db, "/p1.png");
    expect(p?.kind === "photo" && p.photo.id).toBe("aaaaaaaaa2");
    expect(await getPathAccess(db, "/c/a.png")).toEqual({
      kind: "camera-image",
      file: "/c/a.png",
    });
  });

  it("refuses unlisted, private and unknown files", async () => {
    const { raw, db } = setup();
    // A private photo also listed as a camera picture stays private.
    run(
      raw,
      "INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/x.png', 5)",
    );
    expect(await getPathAccess(db, "/x.png")).toBeNull();
    expect(await getPathAccess(db, "/u.png")).toBeNull();
    expect(await getPathAccess(db, "/none.png")).toBeNull();
  });

  it("finds a photo by its display path, needing the file name public", async () => {
    const { raw, db } = setup();
    run(raw, `UPDATE media SET metadata_visibility = '{"file_name":"name"}' WHERE id = 1`);
    expect(await getPathAccess(db, "/p1.png")).toBeNull();
    // Moved: found at the new path, with the bucket key to fetch; the old
    // path (which would give the old place away) is not found.
    run(raw, "UPDATE media SET path = '/moved/p2.png' WHERE id = 2");
    expect(await getPathAccess(db, "/p2.png")).toBeNull();
    const moved = await getPathAccess(db, "/moved/p2.png");
    expect(moved?.kind === "photo" && moved.photo.file).toBe("/p2.png");
    expect(moved?.kind === "photo" && moved.photo.path).toBe("/moved/p2.png");
  });
});

describe("a photo whose file name is hidden", () => {
  it("is listed and opened without its file, path or name", async () => {
    const { db } = setup();
    const listed = (await listPublicMedia(db)).find(
      (m) => m.id === "aaaaaaaaa7",
    );
    expect(listed).toMatchObject({ file: null, path: null, name: null });
    expect(JSON.stringify(listed)).not.toContain("p3");
    expect((await getMedia(db, "aaaaaaaaa7"))?.file).toBeNull();
  });

  it("is not served by its bucket path", async () => {
    expect(await getPathAccess(setup().db, "/p3.png")).toBeNull();
  });

  it("gives its file to the image Worker only (RPC)", async () => {
    const { db } = setup();
    expect((await getPhotoForImage(db, "aaaaaaaaa7"))?.file).toBe("/p3.png");
    // Still not private ones.
    expect(await getPhotoForImage(db, "aaaaaaaaa5")).toBeNull();
    expect((await getPhotoForImage(db, "aaaaaaaaa4"))?.file).toBe("/u.png");
  });
});

describe("site-wide defaults", () => {
  it("apply where a photo says nothing, and a photo overrides them", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `UPDATE setting SET value = json_set(value, '$.taken_at', 'date', '$.tags', 'hidden')
       WHERE key = 'metadata_visibility';
       UPDATE media SET metadata_visibility = '{"file_name":"path","tags":"public"}' WHERE id = 2;`,
    );
    const p1 = await getMedia(db, "aaaaaaaaa2");
    expect(p1).toMatchObject({
      timestamp: "2023-12-01T00:00:00Z",
      timestamp_precision: "date",
      tags: [],
    });
    expect((await getMedia(db, "aaaaaaaaa3"))?.tags).toEqual(["VRChat"]);
  });
});

describe("world and exif", () => {
  it("go out at their levels; the world's author never does", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `UPDATE media SET world_id = 'wrld_abc', world_name = 'Cat', world_author_id = 'usr_secret',
         exif = '{"iso":200,"lens":"secret-lens"}', metadata_visibility = '{"world":"link","exif":"basic"}'`,
    );
    const p = await getMedia(db, "aaaaaaaaa3");
    expect(p?.world).toEqual({ id: "wrld_abc", name: "Cat" });
    expect(p?.exif).toEqual({ iso: 200 });
    const all = JSON.stringify([
      await listPublicMedia(db),
      await getPhotoForImage(db, "aaaaaaaaa3"),
      await getPathAccess(db, "/p2.png"),
    ]);
    expect(all).not.toContain("usr_secret");
    expect(all).not.toContain("secret-lens");
  });
});

describe("location", () => {
  it("is never returned unless a photo or the site makes it public", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `UPDATE media SET latitude = 35.6812, longitude = 139.7671, location_source = 'exif'`,
    );
    const all = JSON.stringify([
      await listPublicMedia(db),
      await getPhotoForImage(db, "aaaaaaaaa3"),
      await getPathAccess(db, "/p2.png"),
    ]);
    expect(all).not.toContain("35.68");
    run(
      raw,
      `UPDATE media SET metadata_visibility = '{"location":"prefecture"}' WHERE id = 2`,
    );
    expect((await getMedia(db, "aaaaaaaaa3"))?.location).toEqual({
      latitude: 35.7,
      longitude: 139.8,
      precision: "prefecture",
    });
  });
});

describe("tags", () => {
  it("never shows a private tag, anywhere", async () => {
    const { db } = setup();
    const everything = JSON.stringify([
      await listPublicMedia(db),
      await getMedia(db, "aaaaaaaaa3"),
      await getPhotoForImage(db, "aaaaaaaaa3"),
      await getPathAccess(db, "/p2.png"),
    ]);
    expect(everything).toContain("VRChat");
    expect(everything).not.toContain("secret");
  });

  it("treats a tag with no row as private", async () => {
    const { raw, db } = setup();
    run(raw, "DELETE FROM tag WHERE name = 'film'");
    expect((await getMedia(db, "aaaaaaaaa2"))?.tags).toEqual([]);
  });
});

describe("cameras", () => {
  it("lists cameras of public photos by slug, images in order", async () => {
    const cameras = await listCameras(setup().db);
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
    const { db } = setup();
    expect((await getCamera(db, "virtuallens2"))?.images).toHaveLength(2);
    expect((await getCamera(db, "b-public"))?.images).toEqual([]);
    expect((await getCamera(db, "a-unlisted"))?.manufacturer).toBeNull();
    expect(await getCamera(db, "nope")).toBeNull();
  });

  it("hides a camera used only for private photos", async () => {
    expect(await getCamera(setup().db, "pentax-sp")).toBeNull();
  });

  it("hides a camera that its photos show at a lower level", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `UPDATE media SET metadata_visibility = '{"camera":"manufacturer"}' WHERE id = 1`,
    );
    expect((await listCameras(db)).map((c) => c.slug)).toEqual([
      "virtuallens2",
    ]);
    expect(await getCamera(db, "b-public")).toBeNull();
    expect((await getMedia(db, "aaaaaaaaa2"))?.camera).toEqual({
      slug: null,
      name: "B",
      manufacturer: "B",
      model: null,
    });
  });
});

describe("photos in the admin's trash", () => {
  const trash = (raw: DatabaseSync) =>
    run(
      raw,
      "UPDATE media SET trashed_at = '2026-11-18T00:00:00Z' WHERE id IN (1, 2, 3)",
    );

  it("are not listed, opened or served by path", async () => {
    const { raw, db } = setup();
    trash(raw);
    const listed = (await listPublicMedia(db)).map((m) => m.id);
    expect(listed).not.toContain("aaaaaaaaa2");
    expect(listed).not.toContain("aaaaaaaaa3");
    expect(await getMedia(db, "aaaaaaaaa2")).toBeNull();
    expect(await getMedia(db, "aaaaaaaaa4")).toBeNull(); // unlisted
    expect(await getPathAccess(db, "/p1.png")).toBeNull();
  });

  it("do not make their camera visible", async () => {
    const { raw, db } = setup();
    trash(raw);
    // Cameras 4 (row 1), 1 (row 2) and 3 (row 3) had only these photos.
    expect(await listCameras(db)).toEqual([]);
    expect(await getCamera(db, "a-unlisted")).toBeNull();
  });
});

describe("uploads that have not completed", () => {
  it("are not listed, opened or served by path", async () => {
    const { db } = setup();
    expect((await listPublicMedia(db)).map((m) => m.id)).not.toContain(
      "aaaaaaaaa8",
    );
    expect(await getMedia(db, "aaaaaaaaa8")).toBeNull();
    expect(await getMedia(db, "aaaaaaaaa9")).toBeNull();
    // Also listed as a camera picture: still hidden.
    expect(await getPathAccess(db, "/up.png")).toBeNull();
  });

  it("do not make their camera visible", async () => {
    const { db } = setup();
    expect((await listCameras(db)).map((c) => c.slug)).not.toContain(
      "pentax-sp",
    );
    expect(await getCamera(db, "pentax-sp")).toBeNull();
  });

  it("are served once ready", async () => {
    const { raw, db } = setup();
    run(raw, "UPDATE media SET status = 'ready'");
    expect((await getMedia(db, "aaaaaaaaa8"))?.file).toBe("/up.png");
    expect((await getPathAccess(db, "/up.png"))?.kind).toBe("photo");
    expect((await getCamera(db, "pentax-sp"))?.slug).toBe("pentax-sp");
  });
});

describe("projectPhoto", () => {
  const row: MediaJoinRow = {
    public_id: "abcdefghjk",
    file: "/VRChat/a.png",
    path: "/VRChat/a.png",
    platform: "Real",
    timestamp: "2023-12-16T23:12:53.046+09:00",
    tags: '["x", "y"]',
    metadata_visibility: null,
    camera_slug: "vl2",
    camera_name: "VirtualLens2",
    camera_manufacturer: "logilabo",
    camera_model: "VirtualLens2",
    latitude: 35.681236,
    longitude: 139.767125,
    exif: null,
    world_id: null,
    world_name: null,
  };
  const ctx = { site: null, publicTags: new Set(["x"]) };
  const at = (levels: Record<string, string>) =>
    projectPhoto(
      { ...row, metadata_visibility: JSON.stringify(levels) },
      ctx,
    );

  it("shows the file name at each level", () => {
    expect(at({ file_name: "path" })).toMatchObject({
      file: "/VRChat/a.png",
      path: "/VRChat/a.png",
      name: "a.png",
    });
    expect(at({ file_name: "name" })).toMatchObject({
      file: null,
      path: null,
      name: "a.png",
    });
    expect(at({ file_name: "hidden" })).toMatchObject({
      file: null,
      path: null,
      name: null,
    });
    // Built-in default: hidden.
    expect(projectPhoto(row, ctx).name).toBeNull();
  });

  it("gives a moved photo's display path, never its bucket key", () => {
    const moved = projectPhoto(
      {
        ...row,
        path: "/trip/b.png",
        metadata_visibility: '{"file_name":"path"}',
      },
      ctx,
    );
    expect(moved).toMatchObject({
      file: null,
      path: "/trip/b.png",
      name: "b.png",
    });
    expect(JSON.stringify(moved)).not.toContain("VRChat/a.png");
  });

  it("cuts the time it was taken down in its own offset", () => {
    const t = (taken_at: string) => {
      const p = at({ taken_at });
      return [p.timestamp, p.timestamp_precision];
    };
    expect(t("second")).toEqual(["2023-12-16T23:12:53.046+09:00", "second"]);
    expect(t("minute")).toEqual(["2023-12-16T23:12:00+09:00", "minute"]);
    expect(t("date")).toEqual(["2023-12-16T00:00:00+09:00", "date"]);
    expect(t("month")).toEqual(["2023-12-01T00:00:00+09:00", "month"]);
    expect(t("year")).toEqual(["2023-01-01T00:00:00+09:00", "year"]);
    expect(t("hidden")).toEqual([null, null]);
  });

  it("shows the camera at each level", () => {
    expect(at({ camera: "model" }).camera?.slug).toBe("vl2");
    expect(at({ camera: "manufacturer" }).camera).toEqual({
      slug: null,
      name: "logilabo",
      manufacturer: "logilabo",
      model: null,
    });
    expect(at({ camera: "hidden" }).camera).toBeNull();
    // No maker to show: nothing.
    expect(
      projectPhoto(
        {
          ...row,
          camera_manufacturer: null,
          metadata_visibility: '{"camera":"manufacturer"}',
        },
        ctx,
      ).camera,
    ).toBeNull();
  });

  it("shows the camera settings at each level", () => {
    const exif = JSON.stringify({
      make: "SONY",
      lens: "FE 35mm F1.8",
      focal_length_mm: 35,
      f_number: 1.8,
      exposure_time: "1/250",
      iso: 100,
      orientation: 1,
      unknown: "dropped",
      model: 7, // the wrong type: dropped
    });
    const withExif = (exif_level: string) =>
      projectPhoto(
        {
          ...row,
          exif,
          metadata_visibility: JSON.stringify({ exif: exif_level }),
        },
        ctx,
      ).exif;
    expect(withExif("all")).toEqual({
      make: "SONY",
      lens: "FE 35mm F1.8",
      focal_length_mm: 35,
      f_number: 1.8,
      exposure_time: "1/250",
      iso: 100,
      orientation: 1,
    });
    // The default.
    expect(projectPhoto({ ...row, exif }, ctx).exif).toEqual({
      f_number: 1.8,
      exposure_time: "1/250",
      iso: 100,
      focal_length_mm: 35,
    });
    expect(withExif("hidden")).toBeNull();
    expect(projectPhoto(row, ctx).exif).toBeNull();
  });

  it("never says more in the exif than the camera and time levels", () => {
    const exif = JSON.stringify({
      make: "SONY",
      model: "ILCE-7M4",
      iso: 100,
      taken_at_original: "2023-12-16T23:12:53+09:00",
    });
    const at = (levels: Record<string, string>) =>
      projectPhoto(
        {
          ...row,
          exif,
          metadata_visibility: JSON.stringify({ exif: "all", ...levels }),
        },
        ctx,
      ).exif;
    expect(at({})).toEqual({
      make: "SONY",
      model: "ILCE-7M4",
      iso: 100,
      taken_at_original: "2023-12-16T23:12:53+09:00",
    });
    expect(at({ camera: "manufacturer", taken_at: "minute" })).toEqual({
      iso: 100,
    });
    expect(at({ camera: "hidden", taken_at: "hidden" })).toEqual({ iso: 100 });
  });

  it("shows the VRChat world at each level, never its author", () => {
    const world = { world_id: "wrld_abc", world_name: "The Black Cat" };
    const at = (level: string) =>
      projectPhoto(
        {
          ...row,
          ...world,
          metadata_visibility: JSON.stringify({ world: level }),
        },
        ctx,
      ).world;
    expect(at("link")).toEqual({ id: "wrld_abc", name: "The Black Cat" });
    expect(at("name")).toEqual({ name: "The Black Cat" });
    expect(at("hidden")).toBeNull();
    expect(projectPhoto(row, ctx).world).toBeNull();
  });

  it("shows where it was taken only as far as its level allows", () => {
    // Hidden by default.
    expect(projectPhoto(row, ctx).location).toBeNull();
    expect(at({ location: "exact" }).location).toEqual({
      latitude: 35.68124,
      longitude: 139.76713,
      precision: "exact",
    });
    expect(at({ location: "city" }).location).toEqual({
      latitude: 35.68,
      longitude: 139.77,
      precision: "city",
    });
    expect(at({ location: "country" }).location).toEqual({
      latitude: 36,
      longitude: 140,
      precision: "country",
    });
    // Unknown: nothing, whatever the level.
    expect(
      projectPhoto(
        {
          ...row,
          latitude: null,
          longitude: null,
          metadata_visibility: '{"location":"exact"}',
        },
        ctx,
      ).location,
    ).toBeNull();
  });

  it("shows public tags only, or none", () => {
    expect(at({}).tags).toEqual(["x"]);
    expect(at({ tags: "hidden" }).tags).toEqual([]);
  });

  it("treats an unknown level as hidden", () => {
    expect(at({ camera: "everything", taken_at: "nope" })).toMatchObject({
      camera: null,
      timestamp: null,
    });
  });

  it("drops malformed tags", () => {
    expect(projectPhoto({ ...row, tags: "nope" }, ctx).tags).toEqual([]);
    expect(projectPhoto({ ...row, tags: '["x", 1]' }, ctx).tags).toEqual([
      "x",
    ]);
  });
});
