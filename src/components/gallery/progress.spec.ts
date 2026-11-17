import { describe, expect, it } from "vitest";
import { pickOverlayPreset, readWithProgress } from "./progress";

describe("pickOverlayPreset", () => {
  it("picks the smallest preset that covers the drawn width", () => {
    expect(pickOverlayPreset(351, 3)).toBe("w1200"); // phone: 1053px
    expect(pickOverlayPreset(1296, 1)).toBe("w1920"); // 1440px laptop
    expect(pickOverlayPreset(1280, 2)).toBe("w2560"); // exactly 2560px
    expect(pickOverlayPreset(1296, 2)).toBe("w3840"); // 2592px > 2560 → next
    expect(pickOverlayPreset(1728, 1)).toBe("w1920");
  });

  it("falls back to the largest preset", () => {
    expect(pickOverlayPreset(3456, 2)).toBe("w3840");
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
});
