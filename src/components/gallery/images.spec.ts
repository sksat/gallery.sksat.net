import { describe, expect, it } from "vitest";
import {
  dimensionsFromFile,
  GRID_CANDIDATES,
  HIDDEN_ORIGINAL,
  imageUrl,
  videoUrl,
  originalUrl,
  srcSet,
} from "./images";

describe("videos", () => {
  const video = { id: "vdxxxxxxxa", file: "/m/clip.mp4", kind: "video" as const };
  it("show their poster through the Worker, and nothing without it", () => {
    expect(imageUrl("https://s3/", video, "https://g/img", "h240")).toBe(
      "https://g/img/vdxxxxxxxa?size=h240",
    );
    // The original is no image: never used as one.
    expect(imageUrl("https://s3/", video, undefined, "h240")).toBe(
      HIDDEN_ORIGINAL,
    );
  });
  it("play from /video/<id> on the same host", () => {
    expect(videoUrl("vdxxxxxxxa", undefined)).toBe("/video/vdxxxxxxxa");
    expect(videoUrl("vdxxxxxxxa", "https://x/v/")).toBe(
      "https://x/v/vdxxxxxxxa",
    );
  });
});

describe("dimensionsFromFile", () => {
  it("reads the size from a VRChat screenshot name", () => {
    expect(
      dimensionsFromFile(
        "/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png",
      ),
    ).toEqual({ width: 7680, height: 4320 });
  });

  it("is empty when the name has no size", () => {
    expect(dimensionsFromFile("/2023-12-comsys2023/DSC01234.JPG")).toEqual({});
    expect(dimensionsFromFile("/a_0x10.png")).toEqual({});
  });
});

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

  it("never needs the name of a photo whose name is not public", () => {
    const hidden = { id: "abcdefghjk", file: null };
    expect(imageUrl(s3, hidden, base, "h240")).toBe(
      "https://gallery.sksat.net/img/abcdefghjk?size=h240",
    );
    // Without the image Worker there is no URL for it: a stand-in.
    expect(imageUrl(s3, hidden, undefined, "h240")).toBe(HIDDEN_ORIGINAL);
    expect(dimensionsFromFile(null)).toEqual({});
  });

  it("points at the image Worker preset", () => {
    expect(imageUrl(s3, file, base, "h240")).toBe(
      "https://gallery.sksat.net/img/VRChat/a.png?size=h240",
    );
  });

  it("addresses a photo by its public id", () => {
    const photo = { id: "abcdefghjk", file };
    expect(imageUrl(s3, photo, base, "h240")).toBe(
      "https://gallery.sksat.net/img/abcdefghjk?size=h240",
    );
    expect(imageUrl(s3, photo, undefined, "h240")).toBe(
      originalUrl(s3, file),
    );
    expect(srcSet(s3, photo, base, GRID_CANDIDATES)).toBe(
      "https://gallery.sksat.net/img/abcdefghjk?size=h240 1x, " +
        "https://gallery.sksat.net/img/abcdefghjk?size=h480 2x",
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
      "https://gallery.sksat.net/img/VRChat/a.png?size=h240 1x, " +
        "https://gallery.sksat.net/img/VRChat/a.png?size=h480 2x",
    );
  });
});
