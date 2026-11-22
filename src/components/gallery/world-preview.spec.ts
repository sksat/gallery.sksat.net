import { describe, expect, it } from "vitest";

import {
  cardPosition,
  parseWorldCard,
  worldCardUrl,
  worldImageUrl,
} from "./world-preview";

describe("parseWorldCard", () => {
  it("takes the API's card", () => {
    expect(
      parseWorldCard({
        name: "Home",
        author: "someone",
        description: "a place",
        image: true,
      }),
    ).toEqual({
      name: "Home",
      author: "someone",
      description: "a place",
      image: true,
    });
    expect(parseWorldCard({ name: "Home", author: "", image: "yes" })).toEqual(
      { name: "Home", author: null, description: null, image: false },
    );
  });

  it("is null without a name", () => {
    expect(parseWorldCard({ error: "not found" })).toBeNull();
    expect(parseWorldCard(null)).toBeNull();
    expect(parseWorldCard("Home")).toBeNull();
  });
});

describe("URLs", () => {
  it("asks the site's own origin, and the image Worker for the picture", () => {
    expect(worldCardUrl("abcdefghjk")).toBe("/api/media/abcdefghjk/world");
    expect(worldImageUrl("https://gallery.sksat.net/img/", "abcdefghjk")).toBe(
      "https://gallery.sksat.net/img/world/abcdefghjk",
    );
    expect(worldImageUrl(undefined, "abcdefghjk")).toBeNull();
  });
});

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
