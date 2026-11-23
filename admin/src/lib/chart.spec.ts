import { describe, expect, it } from "vitest";
import {
  bucketAxisLabel,
  bucketTitle,
  changeDirection,
  formatChange,
  currentBucketName,
  niceScale,
  timeAxis,
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

/** Keys of `n` buckets from `start`: UTC hours or JST days. */
const hourKeys = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(`${start}:00:00Z`) + i * 3600_000)
      .toISOString()
      .slice(0, 13),
  );
const dayKeys = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400_000)
      .toISOString()
      .slice(0, 10),
  );

describe("timeAxis", () => {
  it("labels every day of a week", () => {
    const { ticks, days } = timeAxis(dayKeys("2026-11-17", 7));
    expect(ticks.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ticks[0].label).toBe("11/17");
    expect(days).toEqual([]);
  });
  it("labels every 7th day of a month back from today", () => {
    const { ticks } = timeAxis(dayKeys("2026-10-25", 30));
    expect(ticks.map((t) => t.index)).toEqual([1, 8, 15, 22, 29]);
    expect(ticks.at(-1)!.label).toBe("11/23");
  });
  it("labels 24 hours at 0, 6, 12 and 18 JST, and the days", () => {
    // 15:00 JST on 11/22 (06:00 UTC) to 14:00 JST on 11/23.
    const { ticks, days } = timeAxis(hourKeys("2026-11-22T06", 24));
    expect(ticks).toEqual([
      { index: 3, label: "18時" },
      { index: 9, label: "0時" },
      { index: 15, label: "6時" },
      { index: 21, label: "12時" },
    ]);
    expect(days).toEqual([
      { index: 0, label: "11/22 (日)" },
      { index: 9, label: "11/23 (月)" },
    ]);
  });
  it("leaves out the first day when midnight follows within 4 hours", () => {
    // 22:00 JST on 11/22 (13:00 UTC).
    const { days } = timeAxis(hourKeys("2026-11-22T13", 24));
    expect(days).toEqual([{ index: 2, label: "11/23 (月)" }]);
  });
  it("draws nothing for no buckets", () => {
    expect(timeAxis([])).toEqual({ ticks: [], days: [] });
  });
});

describe("bucket names", () => {
  it("names a day as it is", () => {
    expect(bucketAxisLabel("2026-11-08")).toBe("11/8");
    expect(bucketTitle("2026-11-18")).toBe("11/18 (水)");
    expect(currentBucketName("2026-11-18")).toBe("今日");
  });
  it("names an hour by its span in JST", () => {
    expect(bucketAxisLabel("2026-11-18T03")).toBe("12時");
    expect(bucketTitle("2026-11-18T03")).toBe("11/18 (水) 12:00–13:00");
    // 15:00 UTC is the next day's midnight in JST.
    expect(bucketTitle("2026-11-18T15")).toBe("11/19 (木) 0:00–1:00");
    expect(bucketTitle("2026-11-18T14")).toBe("11/18 (水) 23:00–24:00");
    expect(currentBucketName("2026-11-18T05")).toBe("14時台");
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
