import { describe, expect, it, vi } from "vitest";
import {
  createUploadQueue,
  summarize,
  UploadError,
  type InitResult,
  type QueueDeps,
  type UploadItem,
  type UploadSource,
} from "./upload-queue";

const src = (name: string, size = 100, relativePath = name): UploadSource => ({
  name,
  relativePath,
  size,
  type: "image/png",
});

/** Let pending promise callbacks run. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

type Deferred = { resolve: () => void; reject: (e: unknown) => void };

/** Fakes where each PUT waits until the test settles it. */
const harness = (over: Partial<QueueDeps<UploadSource>> = {}) => {
  const puts: (Deferred & { file: string; progress: (n: number) => void })[] =
    [];
  const sleeps: number[] = [];
  let last: UploadItem[] = [];
  let nextId = 1;
  const deps: QueueDeps<UploadSource> = {
    prepare: vi.fn(async (s) => ({
      sha256: s.name.padEnd(64, "0").slice(0, 64),
      contentType: "image/png",
      timestamp: null,
    })),
    init: vi.fn(async (req): Promise<InitResult> => ({
      status: "upload",
      id: nextId++,
      file: req.file,
      url: `https://b2.example/${req.file}`,
      headers: {},
    })),
    put: vi.fn(
      (init, _source, onProgress) =>
        new Promise<void>((resolve, reject) =>
          puts.push({
            file: init.url.slice("https://b2.example/".length),
            resolve,
            reject,
            progress: onProgress,
          }),
        ),
    ),
    complete: vi.fn(async () => {}),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
    onChange: (items) => (last = items),
    ...over,
  };
  const queue = createUploadQueue(deps);
  const status = () => last.map((i) => `${i.name}:${i.status}`);
  return { deps, queue, puts, sleeps, status, items: () => last };
};

describe("createUploadQueue", () => {
  it("uploads into the folder, at most `concurrency` at a time", async () => {
    const h = harness({ concurrency: 2 });
    h.queue.add("/trip", [src("a.png"), src("b.png"), src("c.png")]);
    await flush();
    expect(h.puts.map((p) => p.file)).toEqual(["/trip/a.png", "/trip/b.png"]);
    expect(h.status()).toEqual([
      "a.png:uploading",
      "b.png:uploading",
      "c.png:queued",
    ]);

    h.puts[0].progress(40);
    expect(h.items()[0].loaded).toBe(40);
    expect(summarize(h.items()).progress).toBeCloseTo(40 / 300);

    h.puts[0].resolve();
    await flush();
    expect(h.deps.complete).toHaveBeenCalledWith(1);
    expect(h.puts.map((p) => p.file)).toContain("/trip/c.png");
    h.puts[1].resolve();
    h.puts[2].resolve();
    await flush();
    expect(h.status()).toEqual(["a.png:done", "b.png:done", "c.png:done"]);
    expect(h.items().map((i) => i.mediaId)).toEqual([1, 2, 3]);
    const s = summarize(h.items());
    expect(s.active).toBe(0);
    expect(s.progress).toBe(1);
  });

  it("sends the prepared hash, type and time to init", async () => {
    const h = harness();
    h.queue.add("/", [src("Day 1/x.png", 5, "Day 1/x.png")]);
    await flush();
    expect(h.deps.init).toHaveBeenCalledWith({
      file: "/Day_1/x.png",
      size: 5,
      sha256: "Day 1/x.png".padEnd(64, "0"),
      contentType: "image/png",
      timestamp: null,
    });
  });

  it("takes the path the server picked (a numbered name)", async () => {
    const h = harness({
      init: vi.fn(async (req) => ({
        status: "upload" as const,
        id: 7,
        file: req.file.replace(".png", "-1.png"),
        url: "https://b2.example/x",
        headers: {},
      })),
    });
    h.queue.add("/a", [src("IMG.png")]);
    await flush();
    expect(h.items()[0].file).toBe("/a/IMG-1.png");
    expect(h.items()[0].message).toBe("/a/IMG-1.png として登録します");
  });

  it("asks for the original path again on a manual retry", async () => {
    const h = harness({
      maxAttempts: 1,
      init: vi.fn(async (req) => ({
        status: "upload" as const,
        id: 7,
        file: req.file.replace(".png", "-1.png"),
        url: "https://b2.example/x",
        headers: {},
      })),
    });
    h.queue.add("/a", [src("IMG.png")]);
    await flush();
    h.puts[0].reject(new UploadError("e", true));
    await flush();
    h.queue.retry(h.items()[0].key);
    await flush();
    h.puts[1].resolve();
    await flush();
    expect(vi.mocked(h.deps.init).mock.calls.map(([r]) => r.file)).toEqual([
      "/a/IMG.png",
      "/a/IMG.png",
    ]);
    expect(h.items()[0]).toMatchObject({
      status: "done",
      message: "/a/IMG-1.png として登録します",
    });
  });

  it("skips a file that prepare refuses for good", async () => {
    const h = harness({
      prepare: vi.fn(async () => {
        throw new UploadError("PNG / JPEG ではありません", false);
      }),
    });
    h.queue.add("/", [src("fake.png")]);
    await flush();
    expect(h.status()).toEqual(["fake.png:skipped"]);
    expect(h.items()[0].message).toBe("PNG / JPEG ではありません");
    expect(h.deps.init).not.toHaveBeenCalled();
  });

  it("prepares (hashes) one file at a time", async () => {
    const waiting: (() => void)[] = [];
    let running = 0;
    let most = 0;
    const h = harness({
      prepare: vi.fn(async () => {
        most = Math.max(most, ++running);
        await new Promise<void>((r) => waiting.push(r));
        running--;
        return {
          sha256: "0".repeat(64),
          contentType: "image/png",
          timestamp: null,
        };
      }),
    });
    h.queue.add("/", [src("a.png"), src("b.png"), src("c.png")]);
    for (let i = 0; i < 3; i++) {
      await flush();
      expect(waiting).toHaveLength(i + 1);
      waiting[i]();
    }
    await flush();
    expect(most).toBe(1);
    expect(h.puts).toHaveLength(3);
  });

  it("skips files that cannot be uploaded without calling anything", async () => {
    const h = harness();
    h.queue.add("/a", [src("notes.txt")]);
    await flush();
    expect(h.status()).toEqual(["notes.txt:skipped"]);
    expect(h.items()[0].message).toBeTruthy();
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(summarize(h.items()).progress).toBe(0);
  });

  it("skips a photo that is already uploaded", async () => {
    const h = harness({
      init: vi.fn(async () => ({
        status: "exists" as const,
        id: 9,
        file: "/old/a.png",
      })),
    });
    h.queue.add("/new", [src("a.png")]);
    await flush();
    expect(h.status()).toEqual(["a.png:skipped"]);
    expect(h.items()[0]).toMatchObject({
      mediaId: 9,
      message: "同じ写真が /old/a.png にあります",
    });
    expect(h.deps.put).not.toHaveBeenCalled();
  });

  it("retries a failed PUT with backoff and a fresh init", async () => {
    const shown: (string | null)[] = [];
    const h = harness({
      maxAttempts: 3,
      // What the row says while waiting.
      sleep: vi.fn(async (ms: number) => {
        h.sleeps.push(ms);
        shown.push(h.items()[0].message);
      }),
    });
    h.queue.add("/", [src("a.png")]);
    await flush();
    h.puts[0].reject(new UploadError("network error", true));
    await flush();
    expect(shown).toEqual(["再試行します: network error"]);
    // ...and not once the next try is under way.
    expect(h.items()[0].message).toBeNull();
    h.puts[1].reject(new UploadError("HTTP 503", true));
    await flush();
    h.puts[2].resolve();
    await flush();
    expect(h.status()).toEqual(["a.png:done"]);
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.deps.init).toHaveBeenCalledTimes(3);
    expect(h.deps.prepare).toHaveBeenCalledTimes(1);
  });

  it("fails after maxAttempts and can be retried by hand", async () => {
    const h = harness({ maxAttempts: 2 });
    h.queue.add("/", [src("a.png"), src("b.png")]);
    await flush();
    h.puts[1].resolve(); // b
    h.puts[0].reject(new UploadError("network error", true));
    await flush();
    h.puts[2].reject(new UploadError("network error", true));
    await flush();
    expect(h.status()).toEqual(["a.png:failed", "b.png:done"]);
    expect(h.items()[0].message).toBe("network error");
    expect(summarize(h.items()).count.failed).toBe(1);

    h.queue.retry(h.items()[0].key);
    await flush();
    expect(h.status()[0]).toBe("a.png:uploading");
    h.puts[3].resolve();
    await flush();
    expect(h.status()).toEqual(["a.png:done", "b.png:done"]);
  });

  it("does not retry errors that will not go away", async () => {
    const h = harness({
      init: vi.fn(async () => {
        throw new UploadError("/a.png はすでにあります", false);
      }),
    });
    h.queue.add("/", [src("a.png")]);
    await flush();
    expect(h.status()).toEqual(["a.png:failed"]);
    expect(h.deps.init).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it("retries only the complete call once the file is in the bucket", async () => {
    let calls = 0;
    const h = harness({
      complete: vi.fn(async () => {
        if (++calls === 1) throw new TypeError("Failed to fetch");
      }),
    });
    h.queue.add("/", [src("a.png")]);
    await flush();
    h.puts[0].resolve();
    await flush();
    expect(h.status()).toEqual(["a.png:done"]);
    expect(h.deps.complete).toHaveBeenCalledTimes(2);
    expect(h.deps.put).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([1000]);
  });

  it("retryFailed and clearFinished", async () => {
    const h = harness({ maxAttempts: 1 });
    h.queue.add("/", [src("a.png"), src("b.png"), src("x.txt")]);
    await flush();
    h.puts[0].reject(new UploadError("e", true));
    h.puts[1].resolve();
    await flush();
    expect(h.status()).toEqual(["a.png:failed", "b.png:done", "x.txt:skipped"]);
    h.queue.clearFinished();
    expect(h.status()).toEqual(["a.png:failed"]);
    h.queue.retryFailed();
    await flush();
    expect(h.status()).toEqual(["a.png:uploading"]);
  });
});
