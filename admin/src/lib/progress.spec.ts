import { describe, expect, it } from "vitest";
import { pickPreviewPreset, readWithProgress } from "./progress";

describe("pickPreviewPreset", () => {
  it("picks the smallest preset that covers the drawn width", () => {
    expect(pickPreviewPreset(358, 3)).toBe("w1200"); // phone: 1074px
    expect(pickPreviewPreset(768, 1)).toBe("w1200"); // desktop, 1x
    expect(pickPreviewPreset(600, 2)).toBe("w1200"); // exactly 1200px
    expect(pickPreviewPreset(768, 2)).toBe("w1920"); // desktop, 2x: 1536px
  });

  it("never goes beyond the preview presets", () => {
    expect(pickPreviewPreset(768, 3)).toBe("w1920"); // 2304px
  });
});

const streamOf = (parts: number[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const n of parts) controller.enqueue(new Uint8Array(n));
      controller.close();
    },
  });

describe("readWithProgress", () => {
  it("reports fractions against Content-Length and returns the bytes", async () => {
    const response = new Response(streamOf([25, 25, 50]), {
      headers: { "Content-Length": "100", "Content-Type": "image/avif" },
    });
    const seen: (number | null)[] = [];
    const blob = await readWithProgress(response, (f) => seen.push(f));
    expect(seen).toEqual([0, 0.25, 0.5, 1, 1]);
    expect(blob.size).toBe(100);
    expect(blob.type).toBe("image/avif");
  });

  it("reports null while the total size is unknown", async () => {
    const response = new Response(streamOf([10, 10]));
    const seen: (number | null)[] = [];
    await readWithProgress(response, (f) => seen.push(f));
    expect(seen).toEqual([null, null, null, 1]);
  });

  it("handles a response without a body or Content-Type", async () => {
    const seen: (number | null)[] = [];
    const blob = await readWithProgress(new Response(null), (f) =>
      seen.push(f),
    );
    expect(seen).toEqual([1]);
    expect(blob.size).toBe(0);
    expect(blob.type).toBe("");
  });

  it("caps the fraction at 1 when more bytes arrive than announced", async () => {
    const response = new Response(streamOf([60, 60]), {
      headers: { "Content-Length": "100" },
    });
    const seen: (number | null)[] = [];
    await readWithProgress(response, (f) => seen.push(f));
    expect(seen).toEqual([0, 0.6, 1, 1]);
  });
});
