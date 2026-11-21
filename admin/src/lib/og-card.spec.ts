import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captionLines, coverRect } from "./og-card";

const file = (path: string) => readFileSync(new URL(path, import.meta.url));

describe("card assets", () => {
  it("are the public site's (workers/image/og-assets.sh writes both)", () => {
    for (const [admin, site] of [
      ["../../public/og/og-badge.png", "../../../public/og-badge.png"],
      ["../../public/og/og-shade.png", "../../../public/og-shade.png"],
      [
        "../../public/og/Roboto-Bold-subset.ttf",
        "../../../public/fonts/Roboto-Bold-subset.ttf",
      ],
    ]) {
      expect(file(admin).equals(file(site)), admin).toBe(true);
    }
  });
});

describe("coverRect", () => {
  it("covers the card, centred", () => {
    expect(coverRect(1920, 1080)).toEqual({
      x: 0,
      y: -22,
      width: 1200,
      height: 675,
    });
    expect(coverRect(2160, 3840)).toEqual({
      x: 0,
      y: -751,
      width: 1200,
      height: 2133,
    });
    expect(coverRect(4000, 1000)).toEqual({
      x: -660,
      y: 0,
      width: 2520,
      height: 630,
    });
  });
});

describe("captionLines", () => {
  it("places the lines as the Worker's cardDraw does", () => {
    expect(captionLines({ primary: "a", secondary: "b" })).toEqual([
      { text: "a", size: 40, bottom: 76 },
      { text: "b", size: 28, bottom: 38 },
    ]);
    expect(captionLines({ primary: "a" })).toEqual([
      { text: "a", size: 40, bottom: 56 },
    ]);
    expect(captionLines({ secondary: "b" })).toEqual([
      { text: "b", size: 28, bottom: 63 },
    ]);
    expect(captionLines({})).toEqual([]);
  });
});
