import { describe, expect, it } from "vitest";

import { parseWorldCard, worldCardUrl, worldImageUrl } from "./world-preview";

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
