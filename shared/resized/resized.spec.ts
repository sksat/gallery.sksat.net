import { describe, expect, it } from "vitest";
import { PRESETS } from "../../workers/image/src/request";
import {
  fitSize,
  isResizedPreset,
  planResized,
  RESIZED_PRESET_NAMES,
  RESIZED_PRESETS,
  resizedKey,
} from "./resized";

describe("RESIZED_PRESETS", () => {
  it("are the image Worker's resize presets (cards aside), in order", () => {
    const resize = Object.fromEntries(
      Object.entries(PRESETS).filter(([k]) => !k.startsWith("og")),
    );
    expect(RESIZED_PRESETS).toEqual(resize);
    expect(RESIZED_PRESET_NAMES).toEqual(Object.keys(resize));
  });

  it("knows its names only", () => {
    expect(isResizedPreset("w1200")).toBe(true);
    expect(isResizedPreset("og")).toBe(false);
    expect(isResizedPreset("toString")).toBe(false);
    expect(isResizedPreset(1200)).toBe(false);
  });
});

describe("fitSize", () => {
  it("scales down to the box, keeping the aspect ratio", () => {
    expect(fitSize("h240", 7680, 4320)).toEqual({ width: 427, height: 240 });
    expect(fitSize("w1200", 7680, 4320)).toEqual({ width: 1200, height: 675 });
    expect(fitSize("w3840", 4000, 6000)).toEqual({ width: 3840, height: 5760 });
  });

  it("never enlarges", () => {
    expect(fitSize("w3840", 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitSize("h480", 640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("keeps at least a pixel", () => {
    expect(fitSize("h240", 100000, 10)).toEqual({ width: 100000, height: 10 });
    expect(fitSize("w1200", 1300, 1)).toEqual({ width: 1200, height: 1 });
  });
});

describe("planResized", () => {
  it("makes every preset of a large photo", () => {
    expect(planResized(7680, 4320)).toEqual([
      { preset: "h240", width: 427, height: 240, sameAs: null },
      { preset: "h480", width: 853, height: 480, sameAs: null },
      { preset: "w1200", width: 1200, height: 675, sameAs: null },
      { preset: "w1920", width: 1920, height: 1080, sameAs: null },
      { preset: "w2560", width: 2560, height: 1440, sameAs: null },
      { preset: "w3840", width: 3840, height: 2160, sameAs: null },
    ]);
  });

  it("makes a photo's own size once, for every box it fits", () => {
    expect(planResized(1920, 1080)).toEqual([
      { preset: "h240", width: 427, height: 240, sameAs: null },
      { preset: "h480", width: 853, height: 480, sameAs: null },
      { preset: "w1200", width: 1200, height: 675, sameAs: null },
      { preset: "w1920", width: 1920, height: 1080, sameAs: null },
      { preset: "w2560", width: 1920, height: 1080, sameAs: "w1920" },
      { preset: "w3840", width: 1920, height: 1080, sameAs: "w1920" },
    ]);
    // Smaller than every box: one image.
    const tiny = planResized(200, 100);
    expect(tiny.filter((p) => p.sameAs === null)).toEqual([
      { preset: "h240", width: 200, height: 100, sameAs: null },
    ]);
    expect(tiny.every((p) => p.width === 200 && p.height === 100)).toBe(true);
  });

  it("aliases only to an earlier preset with an image of its own", () => {
    for (const [w, h] of [
      [800, 450],
      [1000, 3000],
      [3000, 1000],
      [2560, 1440],
    ]) {
      const plan = planResized(w, h);
      plan.forEach((p, i) => {
        if (p.sameAs === null) return;
        const target = plan.findIndex((q) => q.preset === p.sameAs);
        expect(target).toBeLessThan(i);
        expect(plan[target].sameAs).toBeNull();
        expect([plan[target].width, plan[target].height]).toEqual([
          p.width,
          p.height,
        ]);
      });
    }
  });

  it("refuses a size that is not one", () => {
    expect(() => planResized(0, 10)).toThrow(RangeError);
    expect(() => planResized(10.5, 10)).toThrow(RangeError);
    expect(() => planResized(NaN, 10)).toThrow(RangeError);
  });
});

describe("resizedKey", () => {
  it("is under the public id and the source file's key", () => {
    expect(resizedKey("8f4pau5wqb", "/VRChat/2023-12/a.png", "w1200")).toBe(
      "img/8f4pau5wqb/VRChat/2023-12/a.png/w1200",
    );
  });
});
