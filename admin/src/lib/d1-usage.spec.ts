import { describe, expect, it, vi } from "vitest";
import {
  GRAPHQL_ENDPOINT,
  fetchD1Usage,
  formatCount,
  getAnalyticsConfig,
  parseD1Usage,
  type SimpleCache,
} from "./d1-usage";

const cfg = { token: "t0k", accountId: "acc", databaseId: "db-1" };
const now = new Date("2026-11-18T03:04:05Z");
const sum = (rowsRead: number, rowsWritten: number) => ({
  sum: { readQueries: 1, writeQueries: 2, rowsRead, rowsWritten },
});
const body = (groups: unknown[]) => ({
  data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: groups }] } },
  errors: null,
});

describe("parseD1Usage", () => {
  it("adds up the groups", () => {
    expect(parseD1Usage(body([sum(10, 1), sum(5, 2)]), "2026-11-18")).toEqual({
      date: "2026-11-18",
      readQueries: 2,
      writeQueries: 4,
      rowsRead: 15,
      rowsWritten: 3,
    });
  });

  it("reads no groups as a day without queries", () => {
    expect(parseD1Usage(body([]), "d")).toMatchObject({
      rowsRead: 0,
      rowsWritten: 0,
    });
  });

  it("rejects errors and unexpected shapes", () => {
    expect(
      parseD1Usage({ data: null, errors: [{ message: "no" }] }, "d"),
    ).toBeNull();
    expect(
      parseD1Usage({ data: { viewer: { accounts: [] } } }, "d"),
    ).toBeNull();
    expect(parseD1Usage(body([{ sum: { rowsRead: "1" } }]), "d")).toBeNull();
    expect(parseD1Usage("x", "d")).toBeNull();
  });
});

const memoryCache = (): SimpleCache & { keys: string[] } => {
  const m = new Map<string, string>();
  return {
    keys: [] as string[],
    async match(k) {
      const v = m.get(k);
      return v === undefined ? undefined : new Response(v);
    },
    async put(k, res) {
      this.keys.push(k);
      m.set(k, await res.text());
    },
  };
};

describe("fetchD1Usage", () => {
  it("needs the token", async () => {
    const f = vi.fn();
    expect(await fetchD1Usage(null, { fetch: f, cache: null, now })).toEqual({
      kind: "no-token",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("asks GraphQL for today's (UTC) totals of the database, then caches", async () => {
    const f = vi.fn(async () => Response.json(body([sum(7, 3)])));
    const cache = memoryCache();
    const deps = { fetch: f as unknown as typeof fetch, cache, now };
    const r = await fetchD1Usage(cfg, deps);
    expect(r).toEqual({
      kind: "ok",
      usage: {
        date: "2026-11-18",
        readQueries: 1,
        writeQueries: 2,
        rowsRead: 7,
        rowsWritten: 3,
      },
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GRAPHQL_ENDPOINT);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer t0k",
    );
    expect(JSON.parse(init.body as string).variables).toEqual({
      accountTag: "acc",
      databaseId: "db-1",
      date: "2026-11-18",
    });
    // The token is not in the cache key.
    expect(cache.keys).toHaveLength(1);
    expect(cache.keys[0]).not.toContain("t0k");

    // Second load: from the cache.
    expect(await fetchD1Usage(cfg, deps)).toEqual(r);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("turns failures into an error without caching", async () => {
    const cache = memoryCache();
    for (const f of [
      async () => new Response("nope", { status: 403 }),
      async () => Response.json({ data: null, errors: [{ message: "x" }] }),
      async () => new Response("not json"),
      async () => {
        throw new Error("network");
      },
    ]) {
      expect(
        await fetchD1Usage(cfg, {
          fetch: f as unknown as typeof fetch,
          cache,
          now,
        }),
      ).toEqual({ kind: "error" });
    }
    expect(cache.keys).toEqual([]);
  });
});

describe("getAnalyticsConfig", () => {
  it("needs the token and both ids", () => {
    const env = {
      CF_ANALYTICS_API_TOKEN: "t",
      CF_ACCOUNT_ID: "a",
      D1_DATABASE_ID: "d",
    };
    expect(getAnalyticsConfig({ env })).toEqual({
      token: "t",
      accountId: "a",
      databaseId: "d",
    });
    expect(
      getAnalyticsConfig({ env: { ...env, CF_ANALYTICS_API_TOKEN: "" } }),
    ).toBeNull();
    expect(getAnalyticsConfig(undefined)).toBeNull();
  });
});

describe("formatCount", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [5_000_000, "5,000,000"],
  ])("%d -> %s", (n, s) => expect(formatCount(n)).toBe(s));
});
