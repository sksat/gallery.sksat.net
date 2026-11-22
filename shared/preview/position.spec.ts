import { describe, expect, it } from "vitest";

import { cardPosition } from "./position";

describe("cardPosition", () => {
  const viewport = { width: 1280, height: 800 };
  const card = { width: 288, height: 300 };

  it("goes under the link, at its left edge", () => {
    expect(
      cardPosition({ top: 80, bottom: 100, left: 960 }, card, viewport),
    ).toEqual({ top: 108, left: 960 });
  });

  it("stays on screen", () => {
    expect(
      cardPosition({ top: 80, bottom: 100, left: 1200 }, card, viewport).left,
    ).toBe(1280 - 288 - 8);
    expect(
      cardPosition({ top: 80, bottom: 100, left: -20 }, card, viewport).left,
    ).toBe(8);
  });

  it("goes above the link when it only fits there", () => {
    expect(
      cardPosition({ top: 700, bottom: 720, left: 20 }, card, viewport).top,
    ).toBe(700 - 8 - 300);
    // Fits nowhere: under it, the page scrolls.
    expect(
      cardPosition(
        { top: 200, bottom: 220, left: 20 },
        { width: 288, height: 700 },
        viewport,
      ).top,
    ).toBe(228);
  });
});
