import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentChanged, CONTENT_VERSION_KEY } from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
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
