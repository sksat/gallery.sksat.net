import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreVisibility, setVisibility } from "./db";
import { moveItems, trashItems } from "./db-ops";
import {
  anyShown,
  contentChanged,
  CONTENT_VERSION_KEY,
  lowersVisibility,
  movedShown,
  safeAnyShown,
  SNAPSHOT_KEY,
  uploadsHideCameraPicture,
  type LastGoodKV,
} from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'cam-a', 'A');
    INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/camera/cam-a/front.png', 0);
    INSERT INTO media (id, file, platform, visibility) VALUES
      (1, '/V/a.png', 'VRChat', 'public'),
      (2, '/V/b.png', 'VRChat', 'unlisted'),
      (3, '/R/c.png', 'Real', 'private');
    INSERT INTO media (id, file, platform, visibility, status) VALUES
      (4, '/camera/cam-a/front.png', 'Real', 'private', 'uploading'),
      (5, '/V/new.png', 'VRChat', 'private', 'uploading');
  `);
  const db = sqliteD1(raw);
  const deleted: string[] = [];
  const kv: LastGoodKV = {
    delete: async (key) => void deleted.push(key),
  };
  const pending: Promise<unknown>[] = [];
  const platform = {
    env: { LAST_GOOD: kv },
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
  };
  const settle = () => Promise.all(pending.splice(0));
  const version = () =>
    (
      raw
        .prepare("SELECT value FROM setting WHERE key = ?")
        .get(CONTENT_VERSION_KEY) as { value: string } | undefined
    )?.value;
  return { raw, db, kv, deleted, platform, settle, version };
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("contentChanged", () => {
  it("writes a new content version each time (the row created on first use)", async () => {
    const t = setup();
    expect(t.version()).toBeUndefined();
    await contentChanged(t.platform, t.db);
    const first = t.version();
    expect(first).toMatch(/^"[0-9a-f]{24}"$/); // a JSON string
    await contentChanged(t.platform, t.db);
    expect(t.version()).not.toBe(first);
    await t.settle();
    expect(t.deleted).toEqual([]);
  });

  it("deletes the snapshot when the change hides something", async () => {
    const t = setup();
    await contentChanged(t.platform, t.db, { hide: true });
    await t.settle();
    expect(t.deleted).toEqual([SNAPSHOT_KEY]);
    expect(t.version()).toBeDefined();
  });

  it("deletes before writing the new version", async () => {
    const t = setup();
    await contentChanged(t.platform, t.db);
    const old = t.version();
    let atDelete: string | undefined;
    const kv: LastGoodKV = {
      delete: async () => {
        atDelete = t.version();
      },
    };
    await contentChanged({ env: { LAST_GOOD: kv } }, t.db, { hide: true });
    // A rebuild for the new version cannot happen before the delete.
    expect(atDelete).toBe(old);
    expect(t.version()).not.toBe(old);
  });

  it("only writes the version without the binding", async () => {
    const t = setup();
    await contentChanged({ env: {} }, t.db, { hide: true });
    await contentChanged(undefined, t.db, { hide: true });
    expect(t.version()).toBeDefined();
    expect(t.deleted).toEqual([]);
  });

  it("has deleted by the time it returns", async () => {
    const t = setup();
    await contentChanged({ env: { LAST_GOOD: t.kv } }, t.db, { hide: true });
    expect(t.deleted).toEqual([SNAPSHOT_KEY]);
  });

  it("never fails the action", async () => {
    const t = setup();
    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    const kv: LastGoodKV = {
      delete: async () => {
        throw new Error("KV write limit");
      },
    };
    await expect(
      contentChanged({ env: { LAST_GOOD: kv } }, broken, { hide: true }),
    ).resolves.toBeUndefined();
    await expect(
      contentChanged({ env: { LAST_GOOD: kv } }, t.db, { hide: true }),
    ).resolves.toBeUndefined();
  });
});

describe("when a change hides something", () => {
  it("lowersVisibility: less visible than before", () => {
    expect(lowersVisibility([{ from: "public", to: "private" }])).toBe(true);
    expect(lowersVisibility([{ from: "public", to: "unlisted" }])).toBe(true);
    expect(lowersVisibility([{ from: "unlisted", to: "private" }])).toBe(true);
    expect(lowersVisibility([{ from: "private", to: "public" }])).toBe(false);
    expect(lowersVisibility([{ from: "unlisted", to: "public" }])).toBe(false);
    expect(lowersVisibility([])).toBe(false);
  });

  it("visibility → private, and its undo", async () => {
    const t = setup();
    const { previous } = await setVisibility(t.db, [1, 3], "private");
    expect(
      lowersVisibility(
        previous.map((p) => ({ from: p.visibility, to: "private" })),
      ),
    ).toBe(true);
    // The undo puts photo 1 back to public: shows more.
    await restoreVisibility(t.db, "private", [
      { visibility: "public", ids: [1] },
    ]);
    expect(lowersVisibility([{ from: "private", to: "public" }])).toBe(false);
  });

  it("bulk: one photo lowered among many raised is enough", () => {
    expect(
      lowersVisibility([
        ...Array.from({ length: 99 }, () => ({
          from: "private" as const,
          to: "public" as const,
        })),
        { from: "public", to: "unlisted" },
      ]),
    ).toBe(true);
  });

  it("a move of a shown photo, not of a private one", async () => {
    const t = setup();
    const shown = await moveItems(t.db, [
      { kind: "photo", id: 1, to: "/R/a.png" },
    ]);
    if (!shown.ok) throw new Error(shown.error);
    expect(await movedShown(t.db, shown.plan)).toBe(true);
    const hidden = await moveItems(t.db, [
      { kind: "photo", id: 3, to: "/V/c.png" },
    ]);
    if (!hidden.ok) throw new Error(hidden.error);
    expect(await movedShown(t.db, hidden.plan)).toBe(false);
    const folder = await moveItems(t.db, [
      { kind: "folder", from: "/V", to: "/W" },
    ]);
    if (!folder.ok) throw new Error(folder.error);
    expect(await movedShown(t.db, folder.plan)).toBe(true);
  });

  it("trashing a shown photo (checked after the trash)", async () => {
    const t = setup();
    const trashed = await trashItems(t.db, { photos: [2], folders: [] });
    expect(await anyShown(t.db, trashed.ids)).toBe(true);
    const priv = await trashItems(t.db, { photos: [3], folders: [] });
    expect(await anyShown(t.db, priv.ids)).toBe(false);
    expect(await anyShown(t.db, [])).toBe(false);
  });

  it("assumes the worst when visibility cannot be read", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    expect(await safeAnyShown(broken, [1])).toBe(true);
  });

  it("an upload over a camera picture's file", async () => {
    const t = setup();
    expect(await uploadsHideCameraPicture(t.db, [4])).toBe(true);
    expect(await uploadsHideCameraPicture(t.db, [5])).toBe(false);
    expect(await uploadsHideCameraPicture(t.db, [])).toBe(false);
  });
});
