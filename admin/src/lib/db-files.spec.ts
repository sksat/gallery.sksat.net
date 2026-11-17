import { describe, expect, it } from "vitest";
import { filesQuery, listMediaFiles } from "./db-files";

describe("filesQuery", () => {
  it("selects only what the files view needs, by file, one past the limit", () => {
    expect(filesQuery({ limit: 10 })).toEqual({
      sql: "SELECT id, file, world FROM media ORDER BY file LIMIT ?",
      args: [11],
    });
  });

  it("applies the world filter and an escaped substring", () => {
    expect(filesQuery({ world: "VRChat", q: "50%_x", limit: 5 })).toEqual({
      sql: "SELECT id, file, world FROM media WHERE world = ? AND file LIKE ? ESCAPE '\\' ORDER BY file LIMIT ?",
      args: ["VRChat", "%50\\%\\_x%", 6],
    });
  });
});

// Minimal D1 stand-in: returns `results` for any statement.
const fakeDb = (results: unknown[]) =>
  ({
    prepare: () => ({
      bind: () => ({ all: async () => ({ results }) }),
    }),
  }) as unknown as D1Database;

describe("listMediaFiles", () => {
  const row = (id: number) => ({ id, file: `/a/${id}.png`, world: "Real" });

  it("is not truncated up to the limit", async () => {
    const r = await listMediaFiles(fakeDb([row(1), row(2)]), { limit: 2 });
    expect(r).toEqual({ rows: [row(1), row(2)], truncated: false });
  });

  it("drops the extra row and reports truncation", async () => {
    const r = await listMediaFiles(fakeDb([row(1), row(2), row(3)]), {
      limit: 2,
    });
    expect(r).toEqual({ rows: [row(1), row(2)], truncated: true });
  });
});
