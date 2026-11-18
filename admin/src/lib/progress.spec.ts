import { describe, expect, it } from "vitest";
import { pickPreviewPreset } from "./progress";

// readWithProgress and the overlay presets are tested with the shared code
// (shared/overlay/progress.spec.ts, run by the root project's Vitest).

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
