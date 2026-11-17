import { describe, expect, it } from "vitest";
import {
  captionFor,
  findCaptionSource,
  formatJst,
  MAX_LINE_LENGTH,
} from "./caption";

const vrchat = {
  file: "/VRChat/2023-12/a.png",
  world: "VRChat",
  timestamp: "2023-12-16T23:12:25.684+09:00",
  camera: { make: "logilabo", model: "VirtualLens2" },
  tags: ["VRChat"],
};
const real = {
  file: "/2023-12-comsys2023/DSC1.JPG",
  world: "Real",
  timestamp: null,
  camera: null,
  tags: ["film"],
};

describe("findCaptionSource", () => {
  it("finds a listed file", () => {
    expect(findCaptionSource([real, vrchat], vrchat.file)).toEqual({
      world: "VRChat",
      timestamp: vrchat.timestamp,
      camera: vrchat.camera,
      tags: ["VRChat"],
    });
  });

  it("is null for unlisted files and non-array indexes", () => {
    expect(findCaptionSource([real], "/other.png")).toBeNull();
    expect(findCaptionSource({ file: real.file }, real.file)).toBeNull();
    expect(findCaptionSource(null, real.file)).toBeNull();
  });

  it("drops malformed fields", () => {
    const odd = {
      file: "/x.png",
      world: 1,
      timestamp: 2,
      camera: { make: "a" },
      tags: ["ok", 3, null],
    };
    expect(findCaptionSource([null, odd], "/x.png")).toEqual({
      world: "",
      timestamp: null,
      camera: null,
      tags: ["ok"],
    });
  });
});

describe("formatJst", () => {
  it("formats in JST whatever the offset", () => {
    expect(formatJst("2023-12-16T23:12:25.684+09:00")).toBe(
      "2023-12-16 23:12 JST",
    );
    expect(formatJst("2023-12-01T15:30:00Z")).toBe("2023-12-02 00:30 JST");
  });

  it("is null for missing or invalid timestamps", () => {
    expect(formatJst(null)).toBeNull();
    expect(formatJst("not a date")).toBeNull();
  });
});

describe("captionFor", () => {
  it("shows the date, camera and tags (world first, de-duplicated)", () => {
    expect(captionFor(vrchat)).toEqual({
      primary: "2023-12-16 23:12 JST",
      secondary: "logilabo VirtualLens2 · #VRChat",
    });
  });

  it("omits the date and camera when unknown", () => {
    expect(captionFor(real)).toEqual({ secondary: "#Real #film" });
  });

  it("keeps only characters the font subset has", () => {
    expect(
      captionFor({ ...real, tags: ["夜景", "night\n<b>"], world: "Real" }),
    ).toEqual({ secondary: "#Real #night<b>" });
  });

  it("joins words inside a tag", () => {
    expect(captionFor({ ...real, tags: ["night  sky"] })).toEqual({
      secondary: "#Real #night_sky",
    });
  });

  it("truncates long lines", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    const { secondary } = captionFor({ ...real, tags });
    expect(secondary).toHaveLength(MAX_LINE_LENGTH);
    expect(secondary?.endsWith("…")).toBe(true);
  });
});
