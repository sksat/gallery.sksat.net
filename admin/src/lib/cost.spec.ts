import { describe, expect, it, vi } from "vitest";
import type { SimpleCache } from "./cf-graphql";
import {
  b2CostUsd,
  fetchB2Usage,
  fetchCostUsage,
  getCostConfig,
  imagesCostUsd,
  monthElapsed,
  parseImagesUsage,
  parseR2Usage,
  parseWorkersUsage,
  projectMonth,
  r2OpClass,
  r2OpsCostUsd,
  r2StorageCostUsd,
  summarizeCost,
  type CostUsage,
} from "./cost";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const account = (node: unknown) => ({
  data: { viewer: { accounts: [node] } },
  errors: null,
});

describe("cost math", () => {
  it("charges every byte in B2 ($6.95 per TB)", () => {
    expect(b2CostUsd(0)).toBe(0);
    expect(b2CostUsd(1e9)).toBeCloseTo(0.00695);
    expect(b2CostUsd(34.6e9)).toBeCloseTo(0.24047);
    expect(b2CostUsd(1e12)).toBeCloseTo(6.95);
  });

  it("charges R2 storage past 10 GB at $0.015/GB", () => {
    expect(r2StorageCostUsd(4.2e9)).toBe(0);
    expect(r2StorageCostUsd(10e9)).toBe(0);
    expect(r2StorageCostUsd(30e9)).toBeCloseTo(0.3);
  });

  it("charges R2 operations past 1M Class A / 10M Class B", () => {
    expect(r2OpsCostUsd(1_000_000, 10_000_000)).toBe(0);
    expect(r2OpsCostUsd(3_000_000, 0)).toBeCloseTo(9);
    expect(r2OpsCostUsd(0, 15_000_000)).toBeCloseTo(1.8);
  });

  it("charges unique transformations past 5,000 at $0.50 per 1,000", () => {
    expect(imagesCostUsd(5000)).toBe(0);
    expect(imagesCostUsd(7000)).toBeCloseTo(1);
  });

  it("classes R2 operations, unknown ones as Class A", () => {
    expect(r2OpClass("PutObject")).toBe("A");
    expect(r2OpClass("ListObjects")).toBe("A");
    expect(r2OpClass("GetObject")).toBe("B");
    expect(r2OpClass("HeadObject")).toBe("B");
    expect(r2OpClass("DeleteObject")).toBe("free");
    expect(r2OpClass("SomethingNew")).toBe("A");
  });

  it("carries month-to-date usage on to the end of the (UTC) month", () => {
    // November has 30 days: halfway is the 16th, 00:00 UTC.
    const mid = new Date("2026-11-16T00:00:00Z");
    expect(monthElapsed(mid)).toBeCloseTo(0.5);
    expect(projectMonth(100, mid)).toBeCloseTo(200);
    // At least a day has passed, so early usage is not blown up.
    const early = new Date("2026-11-01T00:05:00Z");
    expect(monthElapsed(early)).toBeCloseTo(1 / 30);
    expect(projectMonth(10, early)).toBeCloseTo(300);
    // The last moment of the month: as is.
    expect(projectMonth(10, new Date("2026-11-30T23:59:59.999Z"))).toBeCloseTo(
      10,
    );
  });
});

describe("parsing", () => {
  it("reads R2's newest size and the month's operations by class", () => {
    const body = account({
      storage: [
        {
          max: { payloadSize: 4.2e9, metadataSize: 1e6, objectCount: 13000 },
          dimensions: { datetime: "2026-11-23T00:00:00Z" },
        },
      ],
      operations: [
        { sum: { requests: 10 }, dimensions: { actionType: "PutObject" } },
        { sum: { requests: 5 }, dimensions: { actionType: "UploadPart" } },
        { sum: { requests: 100 }, dimensions: { actionType: "GetObject" } },
        { sum: { requests: 7 }, dimensions: { actionType: "DeleteObject" } },
      ],
    });
    expect(parseR2Usage(body)).toEqual({
      bytes: 4.201e9,
      objects: 13000,
      classA: 15,
      classB: 100,
    });
  });

  it("reads an empty bucket and no operations as zero", () => {
    expect(parseR2Usage(account({ storage: [], operations: [] }))).toEqual({
      bytes: 0,
      objects: 0,
      classA: 0,
      classB: 0,
    });
  });

  it("rejects errors and unexpected shapes", () => {
    expect(parseR2Usage({ data: null, errors: [{ message: "no" }] })).toBe(
      null,
    );
    expect(parseR2Usage(account({ storage: [] }))).toBeNull();
    expect(
      parseR2Usage(
        account({
          storage: [],
          operations: [{ sum: { requests: "1" }, dimensions: {} }],
        }),
      ),
    ).toBeNull();
    expect(parseImagesUsage(account({}))).toBeNull();
    expect(
      parseImagesUsage(
        account({
          imagesUniqueTransformationsAccumulatedSinceStartOfMonth: [
            { transformations: null },
          ],
        }),
      ),
    ).toBeNull();
    expect(parseWorkersUsage(account({ workersInvocationsAdaptive: {} }))).toBe(
      null,
    );
  });

  it("takes the largest running total of transformations", () => {
    const rows = (...n: number[]) =>
      account({
        imagesUniqueTransformationsAccumulatedSinceStartOfMonth: n.map(
          (transformations, i) => ({ date: `2026-11-0${i + 1}`, transformations }),
        ),
      });
    expect(parseImagesUsage(rows(1234, 200))).toBe(1234);
    expect(parseImagesUsage(rows())).toBe(0);
  });

  it("adds up Workers requests", () => {
    expect(
      parseWorkersUsage(
        account({
          workersInvocationsAdaptive: [
            { sum: { requests: 8000 } },
            { sum: { requests: 4345 } },
          ],
        }),
      ),
    ).toBe(12345);
  });
});

describe("fetchCostUsage", () => {
  const now = new Date("2026-11-23T03:04:05Z");

  it("needs the token and the account", async () => {
    expect(getCostConfig({ env: { CF_ACCOUNT_ID: "a" } })).toBeNull();
    expect(getCostConfig({ env: { CF_ANALYTICS_API_TOKEN: "t" } })).toBeNull();
    const f = vi.fn();
    const u = await fetchCostUsage(null, {
      fetch: f as unknown as typeof fetch,
      cache: null,
      now,
    });
    expect(u).toEqual({
      r2: { kind: "no-token" },
      images: { kind: "no-token" },
      workers: { kind: "no-token" },
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("asks each dataset on its own; one failing leaves the others", async () => {
    const sent: { query: string; variables: Record<string, string> }[] = [];
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body);
      if (body.query.includes("imagesUniqueTransformations")) {
        return Response.json({
          data: null,
          errors: [{ message: "unknown field" }],
        });
      }
      if (body.query.includes("r2StorageAdaptiveGroups")) {
        return Response.json(account({ storage: [], operations: [] }));
      }
      return Response.json(
        account({ workersInvocationsAdaptive: [{ sum: { requests: 3 } }] }),
      );
    });
    const keys: string[] = [];
    const cache: SimpleCache = {
      match: async () => undefined,
      put: async (k) => {
        keys.push(k);
      },
    };
    const u = await fetchCostUsage(
      { token: "t0k", accountId: "acc" },
      { fetch: f as unknown as typeof fetch, cache, now },
    );
    expect(u).toEqual({
      r2: { kind: "ok", value: { bytes: 0, objects: 0, classA: 0, classB: 0 } },
      images: { kind: "error" },
      workers: { kind: "ok", value: 3 },
    });
    const r2 = sent.find((b) => b.query.includes("r2Operations"))!;
    expect(r2.variables).toEqual({
      accountTag: "acc",
      bucket: "gallery-media-cache",
      storageSince: "2026-10-23T03:00:00Z",
      monthStart: "2026-11-01T00:00:00Z",
      now: "2026-11-23T03:00:00Z",
    });
    const images = sent.find((b) => b.query.includes("images"))!;
    expect(images.variables).toMatchObject({
      monthStart: "2026-11-01",
      today: "2026-11-23",
    });
    const workers = sent.find((b) => b.query.includes("workers"))!;
    expect(workers.variables).toMatchObject({
      dayStart: "2026-11-23T00:00:00Z",
      now: "2026-11-23T03:00:00Z",
    });
    // Only answers that parse are kept; never the token in a key.
    expect(keys).toHaveLength(2);
    expect(keys.join()).not.toContain("t0k");
  });
});

describe("B2 from D1", () => {
  it("adds up every ready B2 file, trash included", async () => {
    const raw = migratedSqlite();
    raw.exec(`INSERT INTO media (id, file, platform, size, status) VALUES
        (1, '/a.png', 'VRChat', 1000, 'ready'),
        (2, '/b.png', 'VRChat', 2000, 'uploading');
      UPDATE media SET trashed_at = '2026-11-01T00:00:00Z' WHERE id = 1;
      INSERT INTO media_file (media_id, role, object_key, status, size) VALUES
        (1, 'edit', '/a-edit.jpg', 'ready', 300),
        (1, 'edit', '/a-failed.jpg', 'failed', 99999);`);
    expect(await fetchB2Usage(sqliteD1(raw))).toEqual({
      bytes: 1300,
      files: 2,
    });
  });
});

describe("summarizeCost", () => {
  const now = new Date("2026-11-16T00:00:00Z"); // halfway through November
  const usage: CostUsage = {
    r2: {
      kind: "ok",
      value: { bytes: 4.2e9, objects: 13000, classA: 600_000, classB: 1e6 },
    },
    images: { kind: "ok", value: 3000 },
    workers: { kind: "ok", value: 12345 },
  };
  const d1 = {
    kind: "ok" as const,
    usage: {
      date: "2026-11-16",
      readQueries: 1,
      writeQueries: 1,
      rowsRead: 45000,
      rowsWritten: 300,
    },
  };

  it("estimates each service and the total", () => {
    const s = summarizeCost(
      { b2: { bytes: 34.6e9, files: 2000 }, usage, d1 },
      now,
    );
    const cost = Object.fromEntries(s.rows.map((r) => [r.key, r.costUsd]));
    expect(cost.b2).toBeCloseTo(0.24047);
    // Class A carried on to 1.2M: 0.2M over the free 1M.
    expect(cost.r2).toBeCloseTo(0.9);
    // 6,000 by the end of the month: 1,000 over.
    expect(cost.images).toBeCloseTo(0.5);
    expect(cost.d1).toBe(0);
    expect(cost.workers).toBe(0);
    expect(cost.free).toBe(0);
    expect(s.totalUsd).toBeCloseTo(0.24047 + 0.9 + 0.5);
    expect(s.partial).toBe(false);
    const meters = Object.fromEntries(s.rows.map((r) => [r.key, r.meters]));
    expect(meters.workers).toEqual([
      { label: "リクエスト", used: 12345, free: 100_000, unit: "count" },
    ]);
    expect(meters.d1.map((m) => m.used)).toEqual([45000, 300]);
  });

  it("leaves out what it could not measure, and says so", () => {
    const none = { kind: "no-token" } as const;
    const s = summarizeCost(
      {
        b2: null,
        usage: { r2: none, images: { kind: "error" }, workers: none },
        d1: none,
      },
      now,
    );
    expect(s.partial).toBe(true);
    expect(s.totalUsd).toBe(0);
    expect(Object.fromEntries(s.rows.map((r) => [r.key, r.state]))).toEqual({
      b2: "no-db",
      r2: "no-token",
      images: "error",
      d1: "no-token",
      workers: "no-token",
      free: "ok",
    });
    // The free plans stay free whatever is known.
    expect(s.rows.find((r) => r.key === "d1")!.costUsd).toBe(0);
  });
});
