import { describe, expect, it } from "vitest";
import { GRID_CANDIDATES, imageUrl, originalUrl, srcSet } from "./images";

const s3 = "https://bucket.example.com";
const file = "/VRChat/a.png";
const base = "https://gallery.sksat.net/img";

describe("originalUrl", () => {
  it("joins the base and the file path", () => {
    expect(originalUrl(s3, file)).toBe(
      "https://bucket.example.com/VRChat/a.png",
    );
  });
});

describe("imageUrl", () => {
  it("returns the original when resizing is off", () => {
    expect(imageUrl(s3, file, undefined, "h240")).toBe(originalUrl(s3, file));
    expect(imageUrl(s3, file, "", "h240")).toBe(originalUrl(s3, file));
  });

  it("points at the image Worker preset", () => {
    expect(imageUrl(s3, file, base, "h240")).toBe(
      "https://gallery.sksat.net/img/h240/VRChat/a.png",
    );
  });

  it("tolerates a trailing slash on the base", () => {
    expect(imageUrl(s3, file, base + "/", "w1200")).toBe(
      imageUrl(s3, file, base, "w1200"),
    );
  });
});

describe("srcSet", () => {
  it("is undefined when resizing is off", () => {
    expect(srcSet(s3, file, undefined, GRID_CANDIDATES)).toBeUndefined();
  });

  it("lists one URL per candidate", () => {
    expect(srcSet(s3, file, base, GRID_CANDIDATES)).toBe(
      "https://gallery.sksat.net/img/h240/VRChat/a.png 1x, " +
        "https://gallery.sksat.net/img/h480/VRChat/a.png 2x",
    );
  });
});
