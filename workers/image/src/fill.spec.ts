/**
 * The copies' maker (fill.ts) with Image Transformations, R2 and the API
 * stubbed: what it asks to transform, what it stores, how it finishes the
 * claim, and its limits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayKey,
  fillCopies,
  makeCopiesNow,
  RUN_TRANSFORMS,
  type CopiesJob,
  type FillEnv,
} from "./fill";

const NOW = Date.UTC(2026, 10, 21, 12);

/** An R2 bucket in memory. */
const fakeBucket = () => {
  const objects = new Map<
    string,
    { body: Uint8Array; type?: string; meta?: Record<string, string> }
  >();
  const bucket = {
    objects,
    put: vi.fn(
      async (
        key: string,
        body: ArrayBuffer | Uint8Array | ReadableStream,
        opts?: {
          httpMetadata?: { contentType?: string };
          customMetadata?: Record<string, string>;
        },
      ) => {
        const bytes =
          body instanceof ReadableStream
            ? new Uint8Array(await new Response(body).arrayBuffer())
            : new Uint8Array(body as ArrayBuffer);
        objects.set(key, {
          body: bytes,
          type: opts?.httpMetadata?.contentType,
          meta: opts?.customMetadata,
        });
        return {};
      },
    ),
    head: vi.fn(async (key: string) =>
      objects.has(key) ? { customMetadata: objects.get(key)!.meta } : null,
    ),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const k of [keys].flat()) objects.delete(k);
    }),
    // Pages of at most 3 (whatever `limit` asks), the cursor being the
    // index of the next, so paging is exercised.
    list: vi.fn(
      async ({
        prefix,
        limit = 1000,
        cursor,
      }: {
        prefix: string;
        limit?: number;
        cursor?: string;
      }) => {
        const keys = [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort();
        const from = Number(cursor ?? 0);
        const size = Math.min(limit, 3);
        const page = keys
          .slice(from, from + size)
          .map((key) => ({ key, customMetadata: objects.get(key)!.meta }));
        return from + size < keys.length
          ? { objects: page, truncated: true, cursor: String(from + size) }
          : { objects: page, truncated: false };
      },
    ),
  };
  return bucket;
};

const photo = {
  id: "8f4pau5wqb",
  file: "/V/a.png",
  platform: "VRChat",
  timestamp: "2023-12-16T23:12:53+09:00",
  timestamp_precision: "second",
  camera: { name: "VirtualLens2", manufacturer: "logilabo", model: "VirtualLens2" },
  tags: [],
};

const job = (over: Partial<CopiesJob> = {}): CopiesJob => ({
  id: 1,
  publicId: "8f4pau5wqb",
  claim: "making:t",
  source: { storage: "b2", key: "/V/a.png" },
  width: 7680,
  height: 4320,
  photo,
  ...over,
});

let transforms: { url: string; preset: string; format?: string; draw?: unknown }[];
let answer: (n: number) => Response;

beforeEach(() => {
  transforms = [];
  answer = () =>
    new Response("image", {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": "5",
        "Cf-Resized": "internal=ok",
      },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        url: string,
        init?: { cf?: { image?: { width?: number; height?: number; format?: string; draw?: unknown } } },
      ) => {
        const image = init?.cf?.image ?? {};
        transforms.push({
          url,
          preset: `${image.width ?? ""}x${image.height ?? ""}`,
          format: image.format,
          draw: image.draw,
        });
        return answer(transforms.length);
      },
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const envWith = (jobs: CopiesJob[], over: Partial<FillEnv> = {}) => {
  const bucket = fakeBucket();
  const finished: string[] = [];
  const claims: (number[] | undefined)[] = [];
  const env = {
    ORIGIN_BASE_URL: "https://bucket.example",
    PUBLIC_ORIGIN: "https://gallery.example",
    MEDIA_CACHE: bucket as unknown as R2Bucket,
    API: {
      claimCopies: vi.fn(async (limit: number, ids?: number[]) => {
        claims.push(ids);
        return jobs.splice(0, limit);
      }),
      finishCopies: vi.fn(async (id: number, _claim: string, outcome: string) => {
        finished.push(`${id}:${outcome}`);
        return true;
      }),
      copiesMaker: vi.fn(async () => "worker" as const),
      photo: vi.fn(async (id: string) => (id === photo.id ? photo : null)),
    },
    ...over,
  } satisfies FillEnv;
  return { env, bucket, finished, claims };
};

const KEY = (preset: string) => `img/8f4pau5wqb/V/a.png/${preset}`;

describe("fillCopies", () => {
  it("has Image Transformations make each copy and card once, and stores them", async () => {
    const { env, bucket, finished } = envWith([job()]);
    expect(await fillCopies(env, NOW)).toBe(8);
    // Six resizes in WebP from the original's URL, then both cards.
    expect(transforms.map((t) => t.format)).toEqual([
      "webp",
      "webp",
      "webp",
      "webp",
      "webp",
      "webp",
      "jpeg",
      "jpeg",
    ]);
    expect(transforms[0].url).toBe("https://bucket.example/V/a.png");
    // The og card's caption is drawn, with the assets of the public site.
    expect(JSON.stringify(transforms[7].draw)).toContain("2023-12-16 23:12 JST");
    expect(JSON.stringify(transforms[7].draw)).toContain(
      "https://gallery.example/og-badge.png",
    );
    expect(bucket.objects.get(KEY("w1200"))?.type).toBe("image/webp");
    expect(bucket.objects.get(KEY("og"))?.meta).toEqual({
      caption: JSON.stringify([
        "2023-12-16 23:12 JST",
        "logilabo VirtualLens2 · #VRChat",
      ]),
    });
    expect(finished).toEqual(["1:made"]);
  });

  it("stores the presets a small photo already fits as aliases, untransformed", async () => {
    const { env, bucket } = envWith([job({ width: 1920, height: 1080, photo: null })]);
    expect(await fillCopies(env, NOW)).toBe(5);
    expect(bucket.objects.get(KEY("w3840"))?.meta).toEqual({
      "same-as": "w1920",
    });
    // A private photo gets no og card.
    expect(bucket.objects.has(KEY("og"))).toBe(false);
    expect(bucket.objects.has(KEY("og-site"))).toBe(true);
  });

  it("removes the copies of a file the photo no longer shows", async () => {
    const { env, bucket } = envWith([job()]);
    bucket.objects.set("img/8f4pau5wqb/V/old.png/h240", { body: new Uint8Array() });
    bucket.objects.set("img/other00002/V/x.png/h240", { body: new Uint8Array() });
    await fillCopies(env, NOW);
    expect(bucket.objects.has("img/8f4pau5wqb/V/old.png/h240")).toBe(false);
    expect(bucket.objects.has("img/other00002/V/x.png/h240")).toBe(true);
  });

  it("stops at the quota and tries again later; leaves a file it refuses to the browser", async () => {
    answer = () =>
      new Response("quota", {
        status: 429,
        headers: { "Cf-Resized": "err=9422" },
      });
    const quota = envWith([job(), job({ id: 2 })]);
    await fillCopies(quota.env, NOW);
    expect(quota.finished).toEqual(["1:failed"]);
    expect(transforms).toHaveLength(1);

    transforms = [];
    answer = () =>
      new Response("bad", { status: 415, headers: { "Cf-Resized": "err=9520" } });
    const refused = envWith([job()]);
    await fillCopies(refused.env, NOW);
    expect(refused.finished).toEqual(["1:browser"]);
  });

  it("marks the copies made when only the caption cannot be drawn, and asks for the card again", async () => {
    // The 8th transformation (the og card) fails on its text.
    answer = (n) =>
      n === 8
        ? new Response("x", { status: 400, headers: { "Cf-Resized": "err=9504" } })
        : new Response("image", {
            headers: { "Content-Type": "image/webp", "Cf-Resized": "internal=ok" },
          });
    const { env, bucket, finished } = envWith([job()]);
    // One try only, no badge-only retry: 8 transformations, not 9.
    expect(await fillCopies(env, NOW)).toBe(8);
    expect(finished).toEqual(["1:made"]);
    expect(bucket.objects.has(KEY("og"))).toBe(false);
    // Left to the admin's browser.
    expect(bucket.objects.get("og-wanted/8f4pau5wqb")?.meta).toEqual({
      "for-browser": "1",
    });
  });

  it("reaches a request past pages of ones left to the browser", async () => {
    const { env, bucket } = envWith([]);
    for (const id of ["2222222222", "3333333333", "4444444444", "5555555555"]) {
      bucket.objects.set(`og-wanted/${id}`, {
        body: new Uint8Array(),
        meta: { "for-browser": "1" },
      });
    }
    bucket.objects.set("og-wanted/8f4pau5wqb", { body: new Uint8Array() });
    expect(await fillCopies(env, NOW)).toBe(1);
    expect(bucket.objects.has("og-wanted/8f4pau5wqb")).toBe(false);
    expect(bucket.objects.get(KEY("og"))?.meta?.caption).toContain("JST");
  });

  it("leaves a card it cannot draw to the browser, and passes over it after", async () => {
    answer = () =>
      new Response("x", {
        status: 400,
        headers: { "Cf-Resized": "err=9504" },
      });
    const { env, bucket } = envWith([]);
    bucket.objects.set("og-wanted/8f4pau5wqb", { body: new Uint8Array() });
    expect(await fillCopies(env, NOW)).toBe(1);
    expect(bucket.objects.get("og-wanted/8f4pau5wqb")?.meta).toEqual({
      "for-browser": "1",
    });
    expect(await fillCopies(env, NOW)).toBe(0);
  });

  it("counts the transformations of a run that throws", async () => {
    const { env, bucket } = envWith([job()], { RESIZE_DAILY_CAP: "100" });
    let puts = 0;
    const put = bucket.put.getMockImplementation()!;
    bucket.put.mockImplementation(async (...args) => {
      if (String(args[0]).startsWith("img/") && ++puts === 3) {
        throw new Error("R2 down");
      }
      return put(...args);
    });
    await expect(fillCopies(env, NOW)).rejects.toThrow("R2 down");
    const counts = [...bucket.objects.entries()]
      .filter(([k]) => k.startsWith(`${dayKey(NOW)}/`))
      .map(([, o]) => o.meta?.count);
    expect(counts).toEqual(["3"]);
  });

  it("does nothing while the site makes the copies in the browser", async () => {
    const { env } = envWith([job()]);
    env.API.copiesMaker = vi.fn(async () => "browser" as const);
    expect(await fillCopies(env, NOW)).toBe(0);
    expect(env.API.claimCopies).not.toHaveBeenCalled();
  });

  it("stays within one invocation's subrequests", async () => {
    const jobs = Array.from({ length: 20 }, (_, i) => job({ id: i + 1 }));
    const { env } = envWith(jobs);
    const used = await fillCopies(env, NOW);
    expect(used).toBeLessThanOrEqual(RUN_TRANSFORMS);
    expect(transforms.length).toBe(used);
    expect(transforms.length).toBeLessThan(50);
  });

  it("keeps to the daily cap, counted in the bucket", async () => {
    const { env, bucket } = envWith([job(), job({ id: 2 })], {
      RESIZE_DAILY_CAP: "12",
    });
    expect(await fillCopies(env, NOW)).toBe(8);
    // One record per run (overlapping runs never overwrite each other's).
    const records = [...bucket.objects.entries()].filter(([k]) =>
      k.startsWith(`${dayKey(NOW)}/`),
    );
    expect(records.map(([, o]) => o.meta)).toEqual([{ count: "8" }]);
    // 4 left today: not enough for a photo.
    expect(await fillCopies(env, NOW)).toBe(0);
    // A new day.
    expect(await fillCopies(env, NOW + 24 * 3600_000)).toBe(8);
  });

  it("remakes the og cards the public handler asked for", async () => {
    const { env, bucket } = envWith([]);
    bucket.objects.set("og-wanted/8f4pau5wqb", { body: new Uint8Array() });
    bucket.objects.set("og-wanted/gone000002", { body: new Uint8Array() });
    expect(await fillCopies(env, NOW)).toBe(1);
    expect(bucket.objects.get(KEY("og"))?.meta?.caption).toContain("JST");
    expect([...bucket.objects.keys()].filter((k) => k.startsWith("og-wanted/"))).toEqual(
      [],
    );
  });
});

describe("makeCopiesNow", () => {
  it("claims the photo just uploaded and makes it", async () => {
    const { env, claims, finished } = envWith([job({ id: 7 })]);
    expect(await makeCopiesNow(env, 7, NOW)).toEqual({
      outcome: "made",
      transforms: 8,
    });
    expect(claims).toEqual([[7]]);
    expect(finished).toEqual(["7:made"]);
  });

  it("does nothing for a photo that is not waiting", async () => {
    const { env } = envWith([]);
    expect(await makeCopiesNow(env, 7, NOW)).toBeNull();
    expect(transforms).toEqual([]);
  });
});
