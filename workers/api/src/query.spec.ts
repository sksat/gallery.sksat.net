// Runs the queries against the admin's real migrations in an in-memory
// SQLite (node:sqlite) through a minimal D1 stand-in, so the visibility
// rules are checked on the actual SQL.
import type { DatabaseSync } from "node:sqlite";
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
import { d1, migratedDb } from "./sqlite-d1.test-helper";

const setup = () => {
  const db = migratedDb();
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
    INSERT INTO camera_image (camera_id, media_id, position) VALUES (3, 7, 9);
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
      platform_name: "VRChat",
      platform_kind: "virtual",
      timestamp: "2023-12-02T00:00:00Z",
      timestamp_precision: "second",
      camera: {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        model: "VirtualLens2",
      },
      digitizer: null,
      digitized_at: null,
      digitized_at_precision: null,
      location: null,
      world: null,
      exif: null,
      embed_exif: true,
      width: null,
      height: null,
      // "secret" is not a public tag.
      tags: ["VRChat"],
      tag_fields: [],
      kind: "image",
      duration_ms: null,
    });
  });
});

describe("pixel size", () => {
  it("is given for public and unlisted photos, whatever the levels", async () => {
    const { raw, db } = setup();
    raw.exec(`UPDATE media SET width = 3000, height = 4000,
      metadata_visibility = '{"file_name":"hidden","taken_at":"hidden","camera":"hidden","exif":"hidden","tags":"hidden"}'`);
    const listed = await listPublicMedia(db);
    expect(listed.map((m) => [m.width, m.height])).toEqual(
      listed.map(() => [3000, 4000]),
    );
    expect(await getMedia(db, "aaaaaaaaa4")).toMatchObject({
      width: 3000,
      height: 4000,
    });
  });

  it("is null when unknown, or when only one side is known", async () => {
    const { raw, db } = setup();
    raw.exec("UPDATE media SET width = 3000 WHERE public_id = 'aaaaaaaaa3'");
    expect(await getMedia(db, "aaaaaaaaa3")).toMatchObject({
      width: null,
      height: null,
    });
  });
});

describe("videos (0017)", () => {
  const video = () => {
    const { raw, db } = setup();
    raw.exec(`INSERT INTO media (public_id, file, platform, timestamp, visibility,
                kind, width, height, duration_ms, video_codec)
              VALUES ('vvvvvvvvv2', '/v/clip.mp4', 'Real', '2023-12-09T00:00:00Z', 'public',
                'video', 1920, 1080, 12345, 'hvc1');
              INSERT INTO media_file (media_id, role, storage, object_key, source_file_id, status)
                SELECT media_id, 'poster', 'b2', '/.poster/pp.jpg', id, 'ready'
                FROM media_file WHERE object_key = '/v/clip.mp4';
              INSERT INTO media_file (media_id, role, storage, object_key, source_file_id, status)
                SELECT media_id, 'play', 'r2', '/v/cc.mp4', id, 'ready'
                FROM media_file WHERE object_key = '/v/clip.mp4';`);
    return { raw, db };
  };

  it("says what a video is, never where its files are", async () => {
    const { db } = video();
    const listed = (await listPublicMedia(db)).find(
      (m) => m.id === "vvvvvvvvv2",
    );
    expect(listed).toMatchObject({
      kind: "video",
      width: 1920,
      height: 1080,
      duration_ms: 12345,
    });
    expect(JSON.stringify(listed)).not.toMatch(/hvc1|pp\.jpg|cc\.mp4/);
    expect(JSON.stringify(await getMedia(db, "vvvvvvvvv2"))).not.toMatch(
      /pp\.jpg|cc\.mp4/,
    );
  });

  it("gives the image Worker its poster to resize and its copy to play", async () => {
    const { db, raw } = video();
    expect(await getPhotoForImage(db, "vvvvvvvvv2")).toMatchObject({
      file: "/v/clip.mp4",
      source: { storage: "b2", key: "/.poster/pp.jpg" },
      play: { storage: "r2", key: "/v/cc.mp4" },
    });
    // Without a ready poster or copy: the original (no image to make), no
    // playback.
    raw.exec("UPDATE media_file SET status = 'uploading' WHERE role IN ('poster', 'play')");
    expect(await getPhotoForImage(db, "vvvvvvvvv2")).toMatchObject({
      source: { storage: "b2", key: "/v/clip.mp4" },
      play: null,
    });
    // A photo has no playback copy.
    expect((await getPhotoForImage(db, "aaaaaaaaa1"))?.play ?? null).toBeNull();
    // Private: nothing, as for a photo.
    raw.exec(
      "UPDATE media SET visibility = 'private' WHERE public_id = 'vvvvvvvvv2'",
    );
    expect(await getPhotoForImage(db, "vvvvvvvvv2")).toBeNull();
  });
});

describe("embed_exif", () => {
  it("follows the photo, else the site, else on", async () => {
    const { raw, db } = setup();
    const one = async () =>
      (await getMedia(db, "aaaaaaaaa3"))?.embed_exif;
    expect(await one()).toBe(true);
    raw.exec("UPDATE setting SET value = 'false' WHERE key = 'embed_exif'");
    expect(await one()).toBe(false);
    raw.exec("UPDATE media SET embed_exif = 1 WHERE public_id = 'aaaaaaaaa3'");
    expect(await one()).toBe(true);
    raw.exec("UPDATE setting SET value = 'true' WHERE key = 'embed_exif'");
    raw.exec("UPDATE media SET embed_exif = 0 WHERE public_id = 'aaaaaaaaa3'");
    expect(await one()).toBe(false);
  });

  it("shows the スキャン機材 and スキャン日時 only at their levels", async () => {
    const { raw, db } = setup();
    raw.exec(`INSERT INTO camera (slug, name, manufacturer, model, kind)
      VALUES ('scanner', 'Scanner', 'GCMC', 'Scanner', 'scanner')`);
    raw.exec(`UPDATE media SET
      digitized_with = (SELECT id FROM camera WHERE slug = 'scanner'),
      digitized_at = '2021-01-01T00:31:12+09:00'
      WHERE public_id = 'aaaaaaaaa3'`);
    const one = () => getMedia(db, "aaaaaaaaa3");
    // Hidden by default: neither the device nor its date, and the scanner
    // is no public camera.
    expect(await one()).toMatchObject({
      digitizer: null,
      digitized_at: null,
      digitized_at_precision: null,
    });
    expect((await listCameras(db)).map((c) => c.slug)).not.toContain(
      "scanner",
    );
    raw.exec(`UPDATE media SET metadata_visibility =
      '{"digitizer":"model","digitized_at":"date"}' WHERE public_id = 'aaaaaaaaa3'`);
    const shown = await one();
    expect(shown?.digitizer).toEqual({
      slug: "scanner",
      name: "Scanner",
      manufacturer: "GCMC",
      model: "Scanner",
    });
    // The shooting camera stays the shooting camera.
    expect(shown?.camera?.slug).toBe("virtuallens2");
    expect(shown).toMatchObject({
      digitized_at: "2021-01-01T00:00:00+09:00",
      digitized_at_precision: "date",
    });
    expect((await listCameras(db)).map((c) => c.slug)).toContain("scanner");
  });

  it("never returns the file's own EXIF or the scan time", async () => {
    const { raw, db } = setup();
    raw.exec(`UPDATE media SET file_exif = '{"make":"NORITSU KOKI","model":"QSS-32"}',
      digitized_at = '2023-12-12T10:00:00+09:00' WHERE public_id = 'aaaaaaaaa3'`);
    const text = JSON.stringify(await getMedia(db, "aaaaaaaaa3"));
    expect(text).not.toMatch(/NORITSU|QSS|scanned|2023-12-12/);
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
      source: { storage: "b2", key: "/c/a.png" },
    });
  });

  it("refuses unlisted, private and unknown files", async () => {
    const { raw, db } = setup();
    // A photo's file cannot be a camera picture of its own (admin 0019).
    expect(() =>
      run(
        raw,
        "INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/x.png', 5)",
      ),
    ).toThrow(/photo's file/);
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
  it("go out at their levels; the photographer and VRCX's extras never do", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `UPDATE media SET world_id = 'wrld_abc', world_name = 'Cat',
         photographer_id = 'usr_secret', photographer_name = 'secret-name',
         vrcx = '{"instance_id":"wrld_abc:1~secret-instance","players":[{"id":"usr_p","name":"secret-player"}]}',
         exif = '{"iso":200,"lens":"secret-lens"}', metadata_visibility = '{"world":"link","exif":"basic"}'`,
    );
    // Not even at the most open levels a photo can set.
    run(
      raw,
      `UPDATE media SET metadata_visibility = '{"world":"link","exif":"basic","file_name":"path","taken_at":"second","camera":"model","location":"exact"}' WHERE id = 2`,
    );
    const p = await getMedia(db, "aaaaaaaaa3");
    expect(p?.world).toEqual({ id: "wrld_abc", name: "Cat" });
    expect(p?.exif).toEqual({ iso: 200 });
    const all = JSON.stringify([
      await getMedia(db, "aaaaaaaaa2"),
      await listPublicMedia(db),
      await getPhotoForImage(db, "aaaaaaaaa3"),
      await getPathAccess(db, "/p2.png"),
    ]);
    for (const secret of [
      "usr_secret",
      "secret-name",
      "secret-instance",
      "usr_p",
      "secret-player",
      "secret-lens",
    ]) {
      expect(all).not.toContain(secret);
    }
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
      `UPDATE media SET metadata_visibility = '{"location":"prefecture"}' WHERE id IN (1, 2)`,
    );
    expect((await getMedia(db, "aaaaaaaaa2"))?.location).toEqual({
      latitude: 35.7,
      longitude: 139.8,
      precision: "prefecture",
    });
    // A VRChat photo has no real-world position, whatever its level.
    expect((await getMedia(db, "aaaaaaaaa3"))?.location).toBeNull();
  });

  it("follows the platform's kind and name in the table", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `UPDATE media SET latitude = 35.681236, longitude = 139.767125,
         metadata_visibility = '{"location":"exact"}' WHERE id = 1;
       INSERT INTO platform (key, name, kind, position)
         VALUES ('Neos-VR', 'Neos VR', 'virtual', 2);`,
    );
    expect((await getMedia(db, "aaaaaaaaa2"))?.location).not.toBeNull();
    // Set on a virtual platform: the position goes.
    run(raw, "UPDATE media SET platform = 'Neos-VR' WHERE id = 1");
    expect(await getMedia(db, "aaaaaaaaa2")).toMatchObject({
      platform: "Neos-VR",
      platform_name: "Neos VR",
      platform_kind: "virtual",
      location: null,
    });
    // A platform made real shows it again, under its new name.
    run(
      raw,
      "UPDATE platform SET kind = 'real', name = 'Neos' WHERE key = 'Neos-VR'",
    );
    const listed = (await listPublicMedia(db)).find(
      (m) => m.id === "aaaaaaaaa2",
    );
    expect(listed).toMatchObject({ platform_name: "Neos", platform_kind: "real" });
    expect(listed?.location).not.toBeNull();
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

describe("tags a camera passes on", () => {
  // Camera 1 (photo 2's) passes on film (public) and secret (private),
  // and keeps night (public) to itself; camera 4 (photo 1's) passes on
  // film, which photo 1 has already.
  const withCameraTags = () => {
    const s = setup();
    run(
      s.raw,
      `INSERT INTO tag (name, public) VALUES ('night', 1);
       INSERT INTO camera_tag (camera_id, tag, propagate, position) VALUES
         (1, 'film', 1, 0), (1, 'secret', 1, 1), (1, 'night', 0, 2),
         (4, 'film', 1, 0);`,
    );
    return s;
  };

  it("adds the camera's public, passed-on tags after the photo's own", async () => {
    const { db } = withCameraTags();
    expect((await getMedia(db, "aaaaaaaaa3"))?.tags).toEqual([
      "VRChat",
      "film",
    ]);
    // Not twice.
    expect((await getMedia(db, "aaaaaaaaa2"))?.tags).toEqual(["film"]);
    const listed = await listPublicMedia(db);
    expect(listed.find((m) => m.id === "aaaaaaaaa3")?.tags).toEqual([
      "VRChat",
      "film",
    ]);
    // The image Worker's lookups (og captions) see the same tags.
    expect((await getPhotoForImage(db, "aaaaaaaaa3"))?.tags).toEqual([
      "VRChat",
      "film",
    ]);
  });

  it("never passes on a private tag, one kept to the camera, or hidden tags", async () => {
    const { raw, db } = withCameraTags();
    const everything = JSON.stringify([
      await listPublicMedia(db),
      await getMedia(db, "aaaaaaaaa3"),
      await getPathAccess(db, "/p2.png"),
    ]);
    expect(everything).not.toContain("secret");
    expect(everything).not.toContain("night");
    run(
      raw,
      `UPDATE media SET metadata_visibility = '{"tags":"hidden"}' WHERE id = 2`,
    );
    expect((await getMedia(db, "aaaaaaaaa3"))?.tags).toEqual([]);
  });

  it("follows the photo's camera and the camera's tags as they are now", async () => {
    const { raw, db } = withCameraTags();
    run(raw, "UPDATE media SET camera_id = NULL WHERE id = 2");
    expect((await getMedia(db, "aaaaaaaaa3"))?.tags).toEqual(["VRChat"]);
    run(raw, "UPDATE media SET camera_id = 1 WHERE id = 2");
    run(raw, "UPDATE camera_tag SET propagate = 0 WHERE camera_id = 1");
    expect((await getMedia(db, "aaaaaaaaa3"))?.tags).toEqual(["VRChat"]);
  });

  it("shows an inherited tag's fields, with the photo's own values", async () => {
    const { raw, db } = withCameraTags();
    run(
      raw,
      `INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
         SELECT 1, id, '銘柄', 'text', 0, 'shown' FROM tag WHERE name = 'film';
       UPDATE media SET tag_values = '{"1":"Portra 400"}' WHERE id = 2;`,
    );
    expect((await getMedia(db, "aaaaaaaaa3"))?.tag_fields).toEqual([
      { tag: "film", label: "銘柄", value: "Portra 400" },
    ]);
  });
});

describe("tag fields", () => {
  // film (public) has 銘柄 (shown), ISO (shown) and ラボ (hidden by
  // default); secret (private) has メモ. Photo 1 (film) and photo 2
  // (VRChat, secret) have values for all of them.
  const withFields = () => {
    const s = setup();
    run(
      s.raw,
      `INSERT INTO tag_field (id, tag_id, label, type, options, position, visibility)
         SELECT 1, id, '銘柄', 'select', '["Portra 400","HP5"]', 0, 'shown' FROM tag WHERE name = 'film';
       INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
         SELECT 2, id, 'ISO', 'number', 1, 'shown' FROM tag WHERE name = 'film';
       INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
         SELECT 3, id, 'ラボ', 'text', 2, 'hidden' FROM tag WHERE name = 'film';
       INSERT INTO tag_field (id, tag_id, label, type, position, visibility)
         SELECT 4, id, 'メモ', 'text', 0, 'shown' FROM tag WHERE name = 'secret';
       UPDATE media SET tag_values = '{"1":"Portra 400","2":400,"3":"Lab A","4":"memo text"}'
         WHERE id IN (1, 2);`,
    );
    return s;
  };

  it("shows the shown fields of the photo's public tags, in order", async () => {
    const { db } = withFields();
    expect((await getMedia(db, "aaaaaaaaa2"))?.tag_fields).toEqual([
      { tag: "film", label: "銘柄", value: "Portra 400" },
      { tag: "film", label: "ISO", value: 400 },
    ]);
    const listed = await listPublicMedia(db);
    expect(listed.find((m) => m.id === "aaaaaaaaa2")?.tag_fields).toHaveLength(
      2,
    );
  });

  it("never shows a field of a tag the photo lacks, or of a private tag", async () => {
    const { db } = withFields();
    // Photo 2 has values for film's fields but not the tag; and secret is
    // private.
    expect((await getMedia(db, "aaaaaaaaa3"))?.tag_fields).toEqual([]);
    const everything = JSON.stringify([
      await listPublicMedia(db),
      await getMedia(db, "aaaaaaaaa3"),
      await getPhotoForImage(db, "aaaaaaaaa3"),
      await getPathAccess(db, "/p2.png"),
    ]);
    expect(everything).not.toContain("memo text");
    expect(everything).not.toContain("メモ");
    expect(everything).not.toContain("Lab A");
  });

  it("follows the photo's own levels and its tags level", async () => {
    const { raw, db } = withFields();
    run(
      raw,
      `UPDATE media SET tag_value_visibility = '{"1":"hidden","3":"shown"}' WHERE id = 1`,
    );
    expect((await getMedia(db, "aaaaaaaaa2"))?.tag_fields).toEqual([
      { tag: "film", label: "ISO", value: 400 },
      { tag: "film", label: "ラボ", value: "Lab A" },
    ]);
    // An unknown level is hidden.
    run(
      raw,
      `UPDATE media SET tag_value_visibility = '{"2":"yes","3":"shown"}' WHERE id = 1`,
    );
    expect(
      (await getMedia(db, "aaaaaaaaa2"))?.tag_fields.map((f) => f.label),
    ).toEqual(["銘柄", "ラボ"]);
    // Tags hidden: their fields too.
    run(
      raw,
      `UPDATE media SET metadata_visibility = '{"tags":"hidden"}' WHERE id = 1`,
    );
    expect((await getMedia(db, "aaaaaaaaa2"))?.tag_fields).toEqual([]);
  });

  it("hides every field once the tag is made private", async () => {
    const { raw, db } = withFields();
    run(raw, "UPDATE tag SET public = 0 WHERE name = 'film'");
    expect((await getMedia(db, "aaaaaaaaa2"))?.tag_fields).toEqual([]);
  });

  it("drops values that do not fit the field", async () => {
    const { raw, db } = withFields();
    run(
      raw,
      `UPDATE media SET tag_values = '{"1":"","2":"400"}' WHERE id = 1`,
    );
    expect((await getMedia(db, "aaaaaaaaa2"))?.tag_fields).toEqual([]);
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

  it("shows a picture that is a photo only while the photo may be opened", async () => {
    const { raw, db } = setup();
    // Camera 1's pictures: its own two, then photo 1 (public), photo 3
    // (unlisted) and photo 4 (private), photo 1 as the default.
    run(
      raw,
      `INSERT INTO camera_image (id, camera_id, media_id, position, caption) VALUES
         (10, 1, 1, -1, 'Public'), (11, 1, 3, 5, NULL), (12, 1, 4, 6, 'Private')`,
    );
    const images = [
      { file: "/camera/virtuallens2/10.photo.jpg", caption: "Public" },
      { file: "/c/a.png", caption: "Front" },
      { file: "/c/b.png", caption: null },
      { file: "/camera/virtuallens2/11.photo.jpg", caption: null },
    ];
    expect((await getCamera(db, "virtuallens2"))?.images).toEqual(images);
    expect(
      (await listCameras(db)).find((c) => c.slug === "virtuallens2")?.images,
    ).toEqual(images);
    // Camera 3's picture is photo 7, still uploading.
    expect((await getCamera(db, "a-unlisted"))?.images).toEqual([]);
    // Served from the photo's file, without its public id or path.
    expect(
      await getPathAccess(db, "/camera/virtuallens2/10.photo.jpg"),
    ).toEqual({
      kind: "camera-image",
      file: "/p1.png",
      source: { storage: "b2", key: "/p1.png" },
    });
    expect(
      (await getPathAccess(db, "/camera/virtuallens2/11.photo.jpg"))?.kind,
    ).toBe("camera-image");
    // The private photo's picture, another camera's slug, an unknown id.
    expect(
      await getPathAccess(db, "/camera/virtuallens2/12.photo.jpg"),
    ).toBeNull();
    expect(await getPathAccess(db, "/camera/b-public/10.photo.jpg")).toBeNull();
    expect(
      await getPathAccess(db, "/camera/virtuallens2/99.photo.jpg"),
    ).toBeNull();

    // Made private, trashed or still uploading: gone from both.
    run(raw, "UPDATE media SET visibility = 'private' WHERE id = 1");
    run(raw, "UPDATE media SET trashed_at = '2026-11-18T00:00:00Z' WHERE id = 3");
    expect((await getCamera(db, "virtuallens2"))?.images).toEqual(
      images.slice(1, 3),
    );
    expect(
      await getPathAccess(db, "/camera/virtuallens2/10.photo.jpg"),
    ).toBeNull();
    expect(
      await getPathAccess(db, "/camera/virtuallens2/11.photo.jpg"),
    ).toBeNull();
    // Camera 3's picture is photo 7, still uploading.
    expect(await getPathAccess(db, "/camera/a-unlisted/3.photo.jpg")).toBeNull();

    // Deleted for good: the picture goes with it.
    run(raw, "DELETE FROM media WHERE id = 4");
    expect(
      raw.prepare("SELECT COUNT(*) AS n FROM camera_image WHERE id = 12").get(),
    ).toEqual({ n: 0 });
  });

  it("serves a photo picture from the file the photo shows", async () => {
    const { raw, db } = setup();
    run(
      raw,
      `INSERT INTO camera_image (id, camera_id, media_id, position) VALUES (10, 1, 2, 0);
       INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status)
         SELECT 100, 2, 'edit', '/p2_edit.jpg', id, 'ready' FROM media_file
         WHERE media_id = 2 AND role = 'original';
       UPDATE media SET active_file_id = 100 WHERE id = 2;`,
    );
    expect(
      await getPathAccess(db, "/camera/virtuallens2/10.photo.jpg"),
    ).toEqual({
      kind: "camera-image",
      file: "/p2_edit.jpg",
      source: { storage: "b2", key: "/p2_edit.jpg" },
    });
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
  const ctx = {
    site: null,
    publicTags: new Set(["x"]),
    embedDefault: true,
    platforms: new Map([
      ["Real", { name: "Real", kind: "real" as const }],
      ["VRChat", { name: "VRChat", kind: "virtual" as const }],
      ["Neos-VR", { name: "Neos VR", kind: "virtual" as const }],
    ]),
  };
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
      lens: "FE 35mm F1.8",
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
      lens: "FE 35mm F1.8",
      iso: 100,
      taken_at_original: "2023-12-16T23:12:53+09:00",
    });
    // The lens follows the camera too: it can name the camera.
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
    // A photo on a virtual platform (VRChat, Neos VR, …) or one with no
    // row: no real-world position, whatever the level.
    for (const platform of ["VRChat", "Neos-VR", "Gone"]) {
      expect(
        projectPhoto(
          { ...row, platform, metadata_visibility: '{"location":"exact"}' },
          ctx,
        ).location,
        platform,
      ).toBeNull();
    }
  });

  it("gives the platform's key, name and kind", () => {
    expect(projectPhoto({ ...row, platform: "Neos-VR" }, ctx)).toMatchObject({
      platform: "Neos-VR",
      platform_name: "Neos VR",
      platform_kind: "virtual",
    });
    expect(projectPhoto({ ...row, platform: "Gone" }, ctx)).toMatchObject({
      platform: "Gone",
      platform_name: "Gone",
      platform_kind: "virtual",
    });
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
