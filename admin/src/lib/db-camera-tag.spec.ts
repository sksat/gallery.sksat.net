import { describe, expect, it } from "vitest";
import {
  addCameraTag,
  listCameraTags,
  passedOnBy,
  passedOnTags,
  photoTags,
  removeCameraTag,
  setCameraTagPropagate,
} from "./db-camera-tag";
import { addTagField, listTagValueInfo, setTagValues } from "./db-tag-field";
import { CONTENT_VERSION_KEY } from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'rollei-35s', 'Rollei 35S'), (2, 'gr', 'GR');
    INSERT INTO media (id, file, platform, tags, camera_id) VALUES
      (1, '/a.jpg', 'Real', '["旅行"]', 1),
      (2, '/b.jpg', 'Real', '["フィルム"]', 1),
      (3, '/c.jpg', 'Real', '[]', 2);
    INSERT INTO tag (name, public) VALUES ('旅行', 1);
  `);
  return { raw, db: sqliteD1(raw) };
};

describe("camera tags", () => {
  it("adds tags in order (a new one private), once", async () => {
    const { raw, db } = setup();
    expect(await addCameraTag(db, 1, "フィルム")).toEqual({
      added: true,
      newTag: true,
    });
    expect(await addCameraTag(db, 1, "旅行", false)).toEqual({
      added: true,
      newTag: false,
    });
    expect((await addCameraTag(db, 1, "フィルム")).added).toBe(false);
    expect(await listCameraTags(db, 1)).toEqual([
      { tag: "フィルム", propagate: true, public: false, position: 0 },
      { tag: "旅行", propagate: false, public: true, position: 1 },
    ]);
    expect(
      raw.prepare("SELECT public FROM tag WHERE name = 'フィルム'").get(),
    ).toEqual({ public: 0 });
  });

  it("passes on only the tags marked so", async () => {
    const { db } = setup();
    await addCameraTag(db, 1, "フィルム");
    await addCameraTag(db, 1, "旅行", false);
    expect(await passedOnBy(db, 1)).toEqual(["フィルム"]);
    expect(await passedOnBy(db, null)).toEqual([]);
    const passed = await passedOnTags(db);
    expect(photoTags(["旅行"], 1, passed)).toEqual(["旅行", "フィルム"]);
    // Not twice.
    expect(photoTags(["フィルム"], 1, passed)).toEqual(["フィルム"]);
    expect(photoTags([], 2, passed)).toEqual([]);
    await setCameraTagPropagate(db, 1, "フィルム", false);
    expect(await passedOnBy(db, 1)).toEqual([]);
  });

  it("takes a tag off and puts it back where it was", async () => {
    const { db } = setup();
    await addCameraTag(db, 1, "a");
    await addCameraTag(db, 1, "b", false);
    await addCameraTag(db, 1, "c");
    const removed = await removeCameraTag(db, 1, "b");
    expect(removed).toEqual({ tag: "b", propagate: false, position: 1 });
    expect(await removeCameraTag(db, 1, "b")).toBeNull();
    await addCameraTag(db, 1, "b", removed!.propagate, removed!.position);
    expect((await listCameraTags(db, 1)).map((t) => t.tag)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("changes the API's content version with every write and undo", async () => {
    const { raw, db } = setup();
    const version = () =>
      (
        raw
          .prepare("SELECT value FROM setting WHERE key = ?")
          .get(CONTENT_VERSION_KEY) as { value: string } | undefined
      )?.value;
    const seen = new Set<string | undefined>([version()]);
    const bumped = async (label: string, write: () => Promise<unknown>) => {
      await write();
      expect(seen.has(version()), label).toBe(false);
      seen.add(version());
    };
    await bumped("add", () => addCameraTag(db, 1, "フィルム"));
    await bumped("propagate", () =>
      setCameraTagPropagate(db, 1, "フィルム", false),
    );
    let removed: Awaited<ReturnType<typeof removeCameraTag>> = null;
    await bumped("remove", async () => {
      removed = await removeCameraTag(db, 1, "フィルム");
    });
    await bumped("undo (add back)", () =>
      addCameraTag(db, 1, "フィルム", removed!.propagate, removed!.position),
    );
  });

  it("gives inherited tags their fields, with values per photo", async () => {
    const { db } = setup();
    await addCameraTag(db, 1, "フィルム");
    const f = await addTagField(db, "フィルム", {
      label: "銘柄",
      type: "text",
      options: null,
    });
    if (!f.ok) throw new Error("setup");
    expect((await listTagValueInfo(db, [1, 3])).map((p) => p.tags)).toEqual([
      ["旅行", "フィルム"],
      [],
    ]);
    // Photo 1 has the tag through its camera: it gets the value; photo 3
    // (another camera) does not.
    const r = await setTagValues(db, [1, 3], { [f.value.id]: "Portra 400" });
    expect(r.ok && r.value.map(([id]) => id)).toEqual([1]);
  });
});
