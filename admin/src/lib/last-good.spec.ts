import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contentChanged,
  CONTENT_VERSION_KEY,
  uploadsOverCameraPicture,
} from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'cam-a', 'A');
    INSERT INTO camera_image (camera_id, file, position) VALUES (1, '/camera/cam-a/front.png', 0);
    INSERT INTO media (id, file, platform, visibility, status) VALUES
      (1, '/camera/cam-a/front.png', 'Real', 'private', 'uploading'),
      (2, '/V/new.png', 'VRChat', 'private', 'uploading');
  `);
  const version = () =>
    (
      raw
        .prepare("SELECT value FROM setting WHERE key = ?")
        .get(CONTENT_VERSION_KEY) as { value: string } | undefined
    )?.value;
  return { db: sqliteD1(raw), version };
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("contentChanged", () => {
  it("writes a new content version each time (the row created on first use)", async () => {
    const t = setup();
    expect(t.version()).toBeUndefined();
    await contentChanged(t.db);
    const first = t.version();
    // A JSON string, as setting values are JSON.
    expect(first).toMatch(/^"[0-9a-f]{24}"$/);
    await contentChanged(t.db);
    expect(t.version()).not.toBe(first);
  });

  it("retries, then fails the action rather than lose the change", async () => {
    const t = setup();
    let calls = 0;
    const flaky = {
      prepare: (sql: string) => {
        calls++;
        if (calls < 3) throw new Error("D1 hiccup");
        return t.db.prepare(sql);
      },
    } as unknown as D1Database;
    await contentChanged(flaky);
    expect(calls).toBe(3);
    expect(t.version()).toBeDefined();

    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    await expect(contentChanged(broken)).rejects.toThrow("もう一度操作");
  });
});

describe("uploadsOverCameraPicture", () => {
  it("is true only for an upload onto a camera picture's file", async () => {
    const t = setup();
    expect(await uploadsOverCameraPicture(t.db, [1])).toBe(true);
    expect(await uploadsOverCameraPicture(t.db, [2])).toBe(false);
    expect(await uploadsOverCameraPicture(t.db, [])).toBe(false);
  });

  it("assumes a change when it cannot tell", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    expect(await uploadsOverCameraPicture(broken, [1])).toBe(true);
  });
});
