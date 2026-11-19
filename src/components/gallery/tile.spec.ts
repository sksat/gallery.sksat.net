import { describe, expect, it } from "vitest";
import {
  aspectOf,
  FALLBACK_ASPECT,
  FILLER_GROW,
  hasKnownSize,
  tileAspect,
  tileStyle,
} from "./tile";

describe("aspectOf", () => {
  it("is width / height", () => {
    expect(aspectOf(3000, 4000)).toBe(0.75);
    expect(aspectOf(7680, 4320)).toBeCloseTo(16 / 9);
  });
  it("is null for a size that is not one", () => {
    expect(aspectOf(0, 10)).toBeNull();
    expect(aspectOf(10, 0)).toBeNull();
    expect(aspectOf(NaN, 10)).toBeNull();
    expect(aspectOf(Infinity, 10)).toBeNull();
  });
});

describe("tileAspect", () => {
  it("takes the API's size first", () => {
    const portrait = { width: 3, height: 4 };
    expect(tileAspect(portrait)).toBe(0.75);
    // Even over the image's own: the API's is as displayed.
    expect(tileAspect(portrait, 2)).toBe(0.75);
  });
  it("then the loaded image's, else 3:2", () => {
    const unknown = { width: null, height: null };
    expect(tileAspect(unknown, 0.8)).toBe(0.8);
    expect(tileAspect(unknown)).toBe(FALLBACK_ASPECT);
    expect(tileAspect({ width: 0, height: 4 })).toBe(FALLBACK_ASPECT);
  });
  it("never takes a file name's size", () => {
    // The API leaves the size out while an edit (maybe cropped) is shown,
    // and a VRChat name describes the original.
    const edited = {
      file: "/VRChat_x_1080x1920.png",
      width: null,
      height: null,
    };
    expect(tileAspect(edited, 1.5)).toBe(1.5);
    expect(hasKnownSize(edited)).toBe(false);
  });
});

describe("hasKnownSize", () => {
  it("is whether the API gives the size", () => {
    expect(hasKnownSize({ width: 3, height: 4 })).toBe(true);
    expect(hasKnownSize({ width: null, height: null })).toBe(false);
  });
});

describe("tileStyle", () => {
  it("grows a tile in proportion to its ratio, so its row keeps every ratio", () => {
    expect(tileStyle(0.75)).toEqual({ "--ar": "0.75", "flex-grow": "0.75" });
    expect(tileStyle(16 / 9)).toEqual({
      "--ar": "1.7778",
      "flex-grow": "1.7778",
    });
  });

  it("widens every tile of a row by the same factor (the flexbox math)", () => {
    // A row as flex-wrap lays it out: each tile's basis is the row height
    // times its ratio, and the spare width goes out by flex-grow.
    const rowHeight = 240;
    const width = 1000;
    const ratios = [0.75, 16 / 9, 1.5];
    const grows = ratios.map((r) => Number(tileStyle(r)["flex-grow"]));
    const bases = ratios.map((r) => rowHeight * r);
    const spare = width - bases.reduce((a, b) => a + b, 0);
    const total = grows.reduce((a, b) => a + b, 0);
    const widths = bases.map((b, i) => b + (spare * grows[i]) / total);
    // Each tile keeps its ratio (aspect-ratio), so its height is width /
    // ratio: the same for all of them, and nothing is cropped.
    const heights = widths.map((w, i) => w / ratios[i]);
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 0);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(width);
  });

  it("leaves the last row at the row height: the filler takes its space", () => {
    const rowHeight = 240;
    const ratio = 0.75;
    const spare = 1000 - rowHeight * ratio;
    const w = rowHeight * ratio + (spare * ratio) / (ratio + FILLER_GROW);
    expect(w / ratio).toBeCloseTo(rowHeight, 1);
  });
});
