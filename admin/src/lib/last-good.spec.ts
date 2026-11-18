import { describe, expect, it, vi } from "vitest";
import {
  restoreVisibility,
  setVisibility,
  updateCamera,
  updateMedia,
} from "./db";
import { moveItems, restoreItems, trashItems } from "./db-ops";
import {
  restoreMetadataLevels,
  setMetadataLevels,
  setTagPublic,
} from "./db-meta";
import {
  dropCopies,
  GENERATION_KEY,
  invalidateLastGood,
  lastGoodName,
  MAX_DELETES,
  movedStale,
  staleBefore,
  staleNames,
  type LastGoodKV,
} from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

/** A KV namespace in memory. */
const memoryKV = () => {
  const entries = new Map<string, string>();
  const count = { puts: 0, deletes: 0 };
  const kv: LastGoodKV = {
    get: async (key) => entries.get(key) ?? null,
    put: async (key, value) => {
      count.puts++;
      entries.set(key, value);
    },
    delete: async (key) => {
      count.deletes++;
      entries.delete(key);
    },
  };
  return { kv, entries, count };
};

/** Copies as the API Worker keeps them, generation 0. */
const COPIES = [
  "http:/api/media",
  "http:/api/camera",
  "http:/api/camera/cam-a",
  "http:/api/camera/cam-b",
  "http:/api/media/aaaaaaaaa2",
  "rpc:photo:aaaaaaaaa2",
  "rpc:pathAccess:/V/a.png",
  "http:/api/media/aaaaaaaaa3",
  "rpc:photo:aaaaaaaaa3",
  "rpc:pathAccess:/V/b.png",
  "rpc:pathAccess:/camera/cam-a/front.png",
];

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'cam-a', 'A'), (2, 'cam-b', 'B');
    INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/camera/cam-a/front.png', 0);
    INSERT INTO media (id, public_id, file, platform, visibility, camera_id, tags) VALUES
      (1, 'aaaaaaaaa2', '/V/a.png', 'VRChat', 'public', 1, '["x"]'),
      (2, 'aaaaaaaaa3', '/V/b.png', 'VRChat', 'public', NULL, '[]'),
      (3, 'aaaaaaaaa4', '/R/c.png', 'Real', 'private', 2, '["x"]');
  `);
  const db = sqliteD1(raw);
  const { kv, entries, count } = memoryKV();
  for (const n of COPIES) entries.set(`0:${n}`, "{}");
  const pending: Promise<unknown>[] = [];
  const platform = {
    env: { LAST_GOOD: kv },
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
  };
  const settle = () => Promise.all(pending.splice(0));
  const left = () =>
    [...entries.keys()]
      .filter((k) => k.startsWith("0:"))
      .map((k) => k.slice(2))
      .sort();
  const gone = () => COPIES.filter((n) => !entries.has(`0:${n}`)).sort();
  return { raw, db, kv, entries, count, platform, settle, left, gone };
};

const PHOTO_1 = [
  "http:/api/camera",
  "http:/api/camera/cam-a",
  "http:/api/media",
  "http:/api/media/aaaaaaaaa2",
  "rpc:pathAccess:/V/a.png",
  "rpc:photo:aaaaaaaaa2",
];

const LEFT_AFTER_BULK = [
  "http:/api/camera/cam-b",
  "rpc:pathAccess:/camera/cam-a/front.png",
];

describe("staleNames", () => {
  it("covers a photo's copies, its camera's page and the lists", async () => {
    const t = setup();
    expect(await staleNames(t.db, { photos: [1] })).toEqual(PHOTO_1);
  });

  it("uses the API Worker's names", () => {
    // workers/api/src/last-good.spec.ts pins the same strings.
    expect(lastGoodName.http("/api/media/")).toBe("http:/api/media");
    expect(lastGoodName.photo("aaaaaaaaa2")).toBe("rpc:photo:aaaaaaaaa2");
    expect(lastGoodName.pathAccess("/a/b.png")).toBe("rpc:pathAccess:/a/b.png");
  });

  it("finds the photos of a tag and of a camera", async () => {
    const t = setup();
    const tag = await staleNames(t.db, { tag: "x" });
    expect(tag).toContain("http:/api/media/aaaaaaaaa2");
    expect(tag).toContain("http:/api/media/aaaaaaaaa4");
    expect(tag).not.toContain("http:/api/media/aaaaaaaaa3");
    const camera = await staleNames(t.db, { cameraPhotos: 2 });
    expect(camera).toContain("http:/api/camera/cam-b");
    expect(camera).toContain("http:/api/media/aaaaaaaaa4");
    expect(camera).not.toContain("http:/api/media/aaaaaaaaa2");
  });

  it("names only a camera picture's path for an upload", async () => {
    const t = setup();
    t.raw.exec(`INSERT INTO media (id, public_id, file, platform, status) VALUES
      (4, 'aaaaaaaaa5', '/camera/cam-a/front.png', 'Real', 'ready'),
      (5, 'aaaaaaaaa6', '/V/new.png', 'VRChat', 'ready')`);
    expect(await staleNames(t.db, { uploads: [4, 5] })).toEqual([
      "rpc:pathAccess:/camera/cam-a/front.png",
    ]);
  });
});

describe("invalidateLastGood after admin changes", () => {
  it("visibility → private: the photo's copies and the lists", async () => {
    const t = setup();
    const { previous } = await setVisibility(t.db, [1], "private");
    await invalidateLastGood(t.platform, t.db, {
      photos: previous.map((p) => p.id),
    });
    await t.settle();
    expect(t.gone()).toEqual(PHOTO_1);
    // Photo 2 keeps its copies.
    expect(t.left()).toContain("rpc:photo:aaaaaaaaa3");
  });

  it("a move: the old and the new path", async () => {
    const t = setup();
    t.entries.set("0:rpc:pathAccess:/R/a.png", "{}");
    const r = await moveItems(t.db, [{ kind: "photo", id: 1, to: "/R/a.png" }]);
    if (!r.ok) throw new Error(r.error);
    await invalidateLastGood(t.platform, t.db, movedStale(r.plan));
    await t.settle();
    expect(t.gone()).toContain("rpc:pathAccess:/V/a.png");
    expect(t.entries.has("0:rpc:pathAccess:/R/a.png")).toBe(false);
    expect(t.gone()).toContain("rpc:photo:aaaaaaaaa2");
  });

  it("a folder rename: every photo in it", async () => {
    const t = setup();
    const r = await moveItems(t.db, [{ kind: "folder", from: "/V", to: "/W" }]);
    if (!r.ok) throw new Error(r.error);
    await invalidateLastGood(t.platform, t.db, movedStale(r.plan));
    await t.settle();
    expect(t.gone()).toEqual(
      expect.arrayContaining([
        "rpc:pathAccess:/V/a.png",
        "rpc:pathAccess:/V/b.png",
        "rpc:photo:aaaaaaaaa2",
        "rpc:photo:aaaaaaaaa3",
      ]),
    );
  });

  it("bulk changes and their undo", async () => {
    const t = setup();
    const { previous } = await setVisibility(t.db, [1, 2], "unlisted");
    await invalidateLastGood(t.platform, t.db, {
      photos: previous.map((p) => p.id),
    });
    await t.settle();
    // Photo 3 (and its camera, cam-b) was not touched.
    expect(t.left()).toEqual(LEFT_AFTER_BULK);

    // The API wrote them again; then the undo.
    for (const n of COPIES) t.entries.set(`0:${n}`, "{}");
    await restoreVisibility(t.db, "unlisted", [
      { visibility: "public", ids: previous.map((p) => p.id) },
    ]);
    await invalidateLastGood(t.platform, t.db, {
      photos: previous.map((p) => p.id),
    });
    await t.settle();
    expect(t.left()).toEqual(LEFT_AFTER_BULK);
  });

  it("metadata levels and their undo", async () => {
    const t = setup();
    const previous = await setMetadataLevels(t.db, [1], { camera: "hidden" });
    expect(previous.map((p) => p.id)).toEqual([1]);
    await invalidateLastGood(t.platform, t.db, { photos: [1] });
    await t.settle();
    expect(t.gone()).toEqual(PHOTO_1);
    for (const n of COPIES) t.entries.set(`0:${n}`, "{}");
    await restoreMetadataLevels(t.db, previous);
    await invalidateLastGood(t.platform, t.db, { photos: [1] });
    await t.settle();
    expect(t.gone()).toEqual(PHOTO_1);
  });

  it("trash and restore", async () => {
    const t = setup();
    const trashed = await trashItems(t.db, { photos: [], folders: ["/V"] });
    await invalidateLastGood(t.platform, t.db, { photos: trashed.ids });
    await t.settle();
    expect(t.gone()).toContain("rpc:pathAccess:/V/b.png");
    for (const n of COPIES) t.entries.set(`0:${n}`, "{}");
    const r = await restoreItems(t.db, trashed.ids);
    await invalidateLastGood(t.platform, t.db, {
      photos: r.restored.map((p) => p.id),
    });
    await t.settle();
    expect(t.gone()).toContain("rpc:photo:aaaaaaaaa3");
  });

  it("a photo's camera change: the old camera's page too", async () => {
    const t = setup();
    const before = await staleBefore(t.platform, t.db, { photos: [1] });
    await updateMedia(t.db, 1, { camera_id: 2 });
    await invalidateLastGood(t.platform, t.db, { photos: [1], names: before });
    await t.settle();
    expect(t.gone()).toEqual(
      expect.arrayContaining([
        "http:/api/camera/cam-a",
        "http:/api/camera/cam-b",
      ]),
    );
  });

  it("a camera's slug change: the old page and its photos", async () => {
    const t = setup();
    const before = await staleBefore(t.platform, t.db, { cameras: [1] });
    await updateCamera(t.db, 1, {
      slug: "cam-z",
      name: "A",
      manufacturer: null,
      manufacturer_url: null,
      model: null,
      kind: null,
      description: null,
      product_url: null,
    } as Parameters<typeof updateCamera>[2]);
    await invalidateLastGood(t.platform, t.db, {
      cameraPhotos: 1,
      names: before,
    });
    await t.settle();
    expect(t.gone()).toEqual(
      expect.arrayContaining([
        "http:/api/camera/cam-a",
        "rpc:photo:aaaaaaaaa2",
      ]),
    );
  });

  it("a tag made private: its photos", async () => {
    const t = setup();
    await setTagPublic(t.db, "x", false);
    await invalidateLastGood(t.platform, t.db, { tag: "x" });
    await t.settle();
    // Photos 1 and 3 have it (3 is private, but its camera page goes too).
    expect(t.gone()).toEqual([...PHOTO_1, "http:/api/camera/cam-b"].sort());
  });

  it("the site defaults: a new generation", async () => {
    const t = setup();
    await invalidateLastGood(t.platform, t.db, { all: true });
    await t.settle();
    const first = t.entries.get(GENERATION_KEY);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(t.count.deletes).toBe(0);
    await invalidateLastGood(t.platform, t.db, { all: true });
    await t.settle();
    // A new value even from the same (possibly stale) read.
    expect(t.entries.get(GENERATION_KEY)).not.toBe(first);
  });

  it("deletes in the current generation", async () => {
    const t = setup();
    t.entries.set(GENERATION_KEY, "7");
    t.entries.set("7:rpc:photo:aaaaaaaaa2", "{}");
    await invalidateLastGood(t.platform, t.db, { photos: [1] });
    await t.settle();
    expect(t.entries.has("7:rpc:photo:aaaaaaaaa2")).toBe(false);
  });
});

describe("dropCopies", () => {
  it("bumps the generation instead of deleting too many keys", async () => {
    const { kv, count, entries } = memoryKV();
    const names = Array.from({ length: MAX_DELETES + 1 }, (_, i) => `n${i}`);
    await dropCopies(kv, names);
    expect(count.deletes).toBe(0);
    expect(entries.get(GENERATION_KEY)).toBeDefined();
  });

  it("bumps the generation when a deletion fails", async () => {
    const { kv, entries } = memoryKV();
    vi.spyOn(console, "error").mockImplementation(() => {});
    kv.delete = async () => {
      throw new Error("KV write limit");
    };
    await dropCopies(kv, ["http:/api/media"]);
    expect(entries.get(GENERATION_KEY)).toBeDefined();
  });

  it("bumps the generation when it cannot be read", async () => {
    const { kv, entries, count } = memoryKV();
    vi.spyOn(console, "error").mockImplementation(() => {});
    kv.get = async () => {
      throw new Error("KV read failed");
    };
    await dropCopies(kv, ["http:/api/media"]);
    expect(count.deletes).toBe(0);
    expect(entries.get(GENERATION_KEY)).toBeDefined();
  });

  it("never rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: LastGoodKV = {
      get: async () => {
        throw new Error("KV down");
      },
      put: async () => {
        throw new Error("KV down");
      },
      delete: async () => {
        throw new Error("KV down");
      },
    };
    await expect(dropCopies(broken, ["a"])).resolves.toBeUndefined();
    await expect(dropCopies(broken, "all")).resolves.toBeUndefined();
  });
});

describe("invalidateLastGood", () => {
  it("does nothing without the binding", async () => {
    const t = setup();
    await invalidateLastGood({ env: {} }, t.db, { photos: [1] });
    await invalidateLastGood(undefined, t.db, { all: true });
    expect(await staleBefore(undefined, t.db, { photos: [1] })).toEqual([]);
    expect(t.gone()).toEqual([]);
  });

  it("runs inline without waitUntil (dev)", async () => {
    const t = setup();
    await invalidateLastGood({ env: { LAST_GOOD: t.kv } }, t.db, {
      photos: [1],
    });
    expect(t.gone()).toEqual(PHOTO_1);
  });

  it("never fails the action, and retires everything if names fail", async () => {
    const t = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
      batch: async () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    await expect(
      invalidateLastGood({ env: { LAST_GOOD: t.kv } }, broken, {
        photos: [1],
      }),
    ).resolves.toBeUndefined();
    expect(t.entries.get(GENERATION_KEY)).toBeDefined();
  });
});
