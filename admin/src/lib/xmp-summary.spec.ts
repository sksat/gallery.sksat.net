import { describe, expect, it } from "vitest";
import { summaryView } from "./xmp-summary";

describe("summaryView", () => {
  it("names Lightroom's settings and the history in words", () => {
    expect(
      summaryView({
        crs: {
          Exposure2012: "+0.50",
          Temperature: "5500",
          HasCrop: "True",
          HasSettings: "True",
          Clarity2012: "+12",
        },
        crs_count: 48,
        history: [
          { action: "saved", agent: "Adobe Lightroom 8.2 (Windows)", when: "2025-04-27T15:02:03+09:00" },
          { action: "converted" },
        ],
        history_count: 5,
      }),
    ).toEqual({
      settings: [
        ["露光量", "+0.50"],
        ["色温度", "5500 K"],
        ["切り抜き", "あり"],
        ["明瞭度", "+12"],
      ],
      moreSettings: 43,
      history: [
        { when: "2025/04/27 15:02", action: "保存", agent: "Adobe Lightroom 8.2 (Windows)" },
        { when: null, action: "変換", agent: null },
      ],
      earlierSteps: 3,
    });
  });

  it("is nothing without a summary", () => {
    expect(summaryView(null)).toBeNull();
    expect(summaryView({})).toBeNull();
  });
});
