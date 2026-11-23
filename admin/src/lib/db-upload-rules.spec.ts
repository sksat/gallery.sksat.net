import { describe, expect, it } from "vitest";
import { initUpload } from "./db-upload";
import {
  applyExisting,
  decideUpload,
  FOLDER_SQL,
  getUploadRules,
  previewExisting,
  restoreExisting,
  setUploadRules,
} from "./db-upload-rules";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { DEFAULT_UPLOAD_RULES, type UploadRule } from "./upload-rules";

const LENS: UploadRule = {
  id: "lens",
  name: "",
  enabled: true,
  conditions: { name: { preset: "vrchat" } },
  actions: {
    cameraId: 1,
    tags: ["vr"],
    visibility: "unlisted",
    metadata: { location: "hidden" },
  },
};

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'virtuallens2', 'VirtualLens2'), (2, 'x-t5', 'X-T5');
    INSERT INTO media (id, file, platform, camera_id, tags, metadata_visibility) VALUES
      (1, '/VRChat/a.png', 'Real', NULL, '["x"]', NULL),
      (2, '/VRChat/b.png', 'VRChat', 2, '[]', '{"location":"exact"}'),
      (3, '/Other/VRChat_2026-11-18_01-02-03.456_3840x2160.png', 'Real', NULL, '[]', NULL),
      (4, '/Other/c.jpg', 'Real', NULL, '[]', NULL);
  `);
  return { raw, db: sqliteD1(raw) };
};

const NAME = "/up/VRChat_2026-11-18_01-02-03.456_3840x2160.png";
const init = {
  file: NAME,
  size: 10,
  contentType: "image/png",
  sha256: "a".repeat(64),
  timestamp: null,
};

describe("upload rules setting", () => {
  it("is the defaults until saved, then what was saved", async () => {
    const { db } = setup();
    expect(await getUploadRules(db)).toEqual(DEFAULT_UPLOAD_RULES);
    await setUploadRules(db, [LENS]);
    expect(await getUploadRules(db)).toEqual([LENS]);
    await setUploadRules(db, []);
    expect(await getUploadRules(db)).toEqual([]);
  });
});

describe("decideUpload", () => {
  it("decides a new row's values on the server, with chips", async () => {
    const { raw, db } = setup();
    await setUploadRules(db, [...DEFAULT_UPLOAD_RULES, LENS]);
    const decided = await decideUpload(db, init);
    expect(decided.row).toEqual({
      platform: "VRChat",
      cameraId: 1,
      tags: ["vr"],
      visibility: "unlisted",
      metadataVisibility: { location: "hidden" },
    });
    expect(decided.applied).toContainEqual({
      field: "platform",
      value: "VRChat",
      rule: "VRChat のファイル名",
    });
    expect(decided.applied).toContainEqual({
      field: "camera",
      value: "VirtualLens2",
      rule: "VRChat のファイル名",
    });
    await initUpload(db, init, { publicId: "abcdefghjk", ...decided.row });
    expect(
      raw
        .prepare(
          "SELECT platform, camera_id, tags, visibility, metadata_visibility, metadata_source FROM media WHERE file = ?",
        )
        .get(NAME),
    ).toEqual({
      platform: "VRChat",
      camera_id: 1,
      tags: '["vr"]',
      visibility: "unlisted",
      metadata_visibility: '{"location":"hidden"}',
      // A rule's camera is a choice: the metadata reader keeps it.
      metadata_source: '{"camera":"manual"}',
    });
  });

  it("puts a rule's camera before the one the file names", async () => {
    const { raw, db } = setup();
    const cameras = () =>
      (raw.prepare("SELECT COUNT(*) AS n FROM camera").get() as { n: number })
        .n;
    const meta = {
      exif: { make: "Canon", model: "Canon EOS R5" },
      fileExif: null,
      digitizedAt: null,
      location: null,
      world: null,
      photographer: null,
      vrcx: null,
    };
    const photo = (file: string, sha: string) => ({
      ...init,
      file,
      sha256: sha.repeat(64),
      meta,
    });
    // Without a rule the file's camera gets a row of its own.
    await initUpload(db, photo("/r/a.jpg", "b"), {
      publicId: "abcdefghj2",
      platform: "Real",
    });
    expect(cameras()).toBe(3);
    await setUploadRules(db, [
      {
        ...LENS,
        id: "r",
        conditions: { folder: "/r" },
        actions: { cameraId: 2 },
      },
    ]);
    const decided = await decideUpload(db, photo("/r/b.jpg", "c"));
    await initUpload(db, photo("/r/b.jpg", "c"), {
      publicId: "abcdefghj3",
      ...decided.row,
    });
    expect(
      raw
        .prepare("SELECT camera_id, metadata_source FROM media WHERE file = ?")
        .get("/r/b.jpg"),
    ).toEqual({
      camera_id: 2,
      metadata_source: '{"exif":"file","camera":"manual"}',
    });
    expect(cameras()).toBe(3);
  });

  it("is Real and private when nothing matches; drops a missing camera", async () => {
    const { db } = setup();
    await setUploadRules(db, [{ ...LENS, actions: { cameraId: 99 } }]);
    const decided = await decideUpload(db, { ...init, file: "/a/b.jpg" });
    expect(decided.row).toEqual({
      platform: "Real",
      cameraId: null,
      tags: [],
      visibility: "private",
      metadataVisibility: {},
    });
    expect((await decideUpload(db, init)).row.cameraId).toBeNull();
  });

  it("looks at CreatorTool and size only when the browser sent them", async () => {
    const { db } = setup();
    await setUploadRules(db, [
      {
        ...LENS,
        conditions: { creatorTool: "vrchat", orientation: "landscape" },
        actions: { platform: "VRChat" },
      },
    ]);
    const file = { ...init, file: "/a/b.png" };
    expect((await decideUpload(db, file)).row.platform).toBe("Real");
    const hints = { creatorTool: "VRChat" };
    // The size is the init's own (from the header, image-size.ts).
    const dimensions = { width: 1920, height: 1080 };
    expect((await decideUpload(db, { ...file, hints })).row.platform).toBe(
      "Real",
    );
    expect(
      (await decideUpload(db, { ...file, hints, dimensions })).row.platform,
    ).toBe("VRChat");
  });
});

describe("applying to existing photos", () => {
  const rules: UploadRule[] = [
    ...DEFAULT_UPLOAD_RULES,
    { ...LENS, id: "folder", conditions: { folder: "/VRChat" } },
  ];

  it("previews per folder and fills only what is empty", async () => {
    const { db } = setup();
    // Photo 2 is VRChat, has a camera and its own location level: only
    // the tag is added.
    expect(await previewExisting(db, rules, "/VRChat")).toEqual({
      photos: 2,
      ids: [1, 2],
      byRule: { "vrchat-folder": 1, folder: 2 },
    });
    const all = await previewExisting(db, rules, "/");
    expect(all.photos).toBe(4);
    expect(all.ids).toEqual([1, 2, 3]);
  });

  it("reads only the folder's rows (the path index)", () => {
    const { raw } = setup();
    const plan = raw
      .prepare(`EXPLAIN QUERY PLAN ${FOLDER_SQL}`)
      .all("/VRChat/*") as { detail: string }[];
    expect(plan.map((p) => p.detail).join("\n")).toMatch(
      /idx_media_path_live \(path>\? AND path<\?\)/,
    );
  });

  it("applies and undoes", async () => {
    const { raw, db } = setup();
    const read = () =>
      raw
        .prepare(
          "SELECT id, platform, camera_id, tags, visibility, metadata_visibility FROM media ORDER BY id",
        )
        .all();
    const before = read();
    const previous = await applyExisting(db, rules, [1, 2, 3, 4]);
    expect(previous.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(read()).toEqual([
      {
        id: 1,
        platform: "VRChat",
        camera_id: 1,
        tags: '["x","vr"]',
        visibility: "private",
        metadata_visibility: '{"location":"hidden"}',
      },
      {
        id: 2,
        platform: "VRChat",
        camera_id: 2,
        tags: '["vr"]',
        visibility: "private",
        metadata_visibility: '{"location":"exact"}',
      },
      {
        id: 3,
        platform: "VRChat",
        camera_id: null,
        tags: "[]",
        visibility: "private",
        metadata_visibility: null,
      },
      {
        id: 4,
        platform: "Real",
        camera_id: null,
        tags: "[]",
        visibility: "private",
        metadata_visibility: null,
      },
    ]);
    // The new tag got its (private) row.
    expect(raw.prepare("SELECT name, public FROM tag").all()).toEqual([
      { name: "vr", public: 0 },
    ]);
    await restoreExisting(db, previous);
    expect(read()).toEqual(before);
  });

  it("marks a camera it sets manual, never fills one cleared by hand, and undoes the mark", async () => {
    const { raw, db } = setup();
    raw.exec(`
      UPDATE media SET metadata_source = '{"taken_at":"exif"}' WHERE id = 1;
      INSERT INTO media (id, file, platform, camera_id, tags, metadata_source)
        VALUES (5, '/VRChat/d.png', 'VRChat', NULL, '[]', '{"camera":"manual"}');
    `);
    const read = () =>
      raw
        .prepare(
          "SELECT id, camera_id, metadata_source AS s FROM media WHERE id IN (1, 5) ORDER BY id",
        )
        .all();
    const before = read();
    const cameraRule: UploadRule = {
      ...LENS,
      id: "cam",
      conditions: { folder: "/VRChat" },
      actions: { cameraId: 1 },
    };
    const previous = await applyExisting(db, [cameraRule], [1, 5]);
    expect(previous.map((p) => [p.id, p.camera_source])).toEqual([[1, null]]);
    expect(read()).toEqual([
      { id: 1, camera_id: 1, s: '{"taken_at":"exif","camera":"manual"}' },
      // Cleared by hand: left as it is.
      { id: 5, camera_id: null, s: '{"camera":"manual"}' },
    ]);
    await restoreExisting(db, previous);
    expect(read()).toEqual(before);
  });

  it("bumps the API's content version when it applies or undoes", async () => {
    const { raw, db } = setup();
    const version = () =>
      (
        raw
          .prepare("SELECT value FROM setting WHERE key = 'content_version'")
          .get() as { value: string } | undefined
      )?.value;
    const previous = await applyExisting(db, rules, [1, 2, 3, 4]);
    const applied = version();
    expect(applied).toBeDefined();
    await restoreExisting(db, previous);
    expect(version()).not.toBe(applied);
    // Nothing to change: nothing written, no bump.
    const now = version();
    await applyExisting(db, rules, [4]);
    expect(version()).toBe(now);
  });
});
