import { describe, expect, it } from "vitest";
import {
  bucketAxisLabel,
  bucketTitle,
  changeDirection,
  formatChange,
  labelledIndexes,
  niceScale,
} from "./chart";

describe("niceScale", () => {
  it.each([
    [0, 1, [0, 1]],
    [1, 1, [0, 1]],
    [3, 3, [0, 1, 2, 3]],
    [32, 40, [0, 20, 40]],
    [41, 60, [0, 20, 40, 60]],
    [250, 300, [0, 100, 200, 300]],
    [1234, 1500, [0, 500, 1000, 1500]],
  ])("%d → top %d", (max, top, ticks) => {
    expect(niceScale(max)).toEqual({ top, ticks });
  });
});

describe("labelledIndexes", () => {
  it("labels every day of a week", () => {
    expect(labelledIndexes(7, false)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("labels every 6th hour and 7th day back from the newest", () => {
    expect(labelledIndexes(24, true)).toEqual([5, 11, 17, 23]);
    expect(labelledIndexes(30, false)).toEqual([1, 8, 15, 22, 29]);
  });
});

describe("bucket names", () => {
  it("names a day as it is", () => {
    expect(bucketAxisLabel("2026-11-08")).toBe("11/8");
    expect(bucketTitle("2026-11-18")).toBe("11/18 (水)");
  });
  it("names an hour in JST", () => {
    expect(bucketAxisLabel("2026-11-18T03")).toBe("12時");
    expect(bucketTitle("2026-11-18T03")).toBe("11/18 12:00–13:00");
    // 15:00 UTC is the next day's midnight in JST.
    expect(bucketTitle("2026-11-18T15")).toBe("11/19 0:00–1:00");
  });
});

describe("change", () => {
  it.each([
    [0.123, "+12%", "up"],
    [-0.084, "−8%", "down"],
    [0.004, "±0%", "flat"],
    [-0.004, "±0%", "flat"],
    [1.5, "+150%", "up"],
  ] as const)("%d", (ratio, text, dir) => {
    expect(formatChange(ratio)).toBe(text);
    expect(changeDirection(ratio)).toBe(dir);
  });
});
