import { describe, expect, it } from "vitest";
import {
  captionFor,
  formatJst,
  MAX_LINE_LENGTH,
} from "./caption";

const vrchat = {
  file: "/VRChat/2023-12/a.png",
  platform: "VRChat",
  timestamp: "2023-12-16T23:12:25.684+09:00",
  camera: {
    name: "VirtualLens2",
    manufacturer: "logilabo",
    model: "VirtualLens2",
  },
  tags: ["VRChat"],
};
const real = {
  file: "/2023-12-comsys2023/DSC1.JPG",
  platform: "Real",
  timestamp: null,
  camera: null,
  tags: ["film"],
};

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
  it("shows the date, camera and tags (platform first, de-duplicated)", () => {
    expect(captionFor(vrchat)).toEqual({
      primary: "2023-12-16 23:12 JST",
      secondary: "logilabo VirtualLens2 · #VRChat",
    });
  });

  it("uses the camera name without manufacturer and model", () => {
    expect(
      captionFor({
        ...real,
        camera: { name: "PENTAX SP", manufacturer: null, model: null },
      }),
    ).toEqual({ secondary: "PENTAX SP · #Real #film" });
  });

  it("omits the date and camera when unknown", () => {
    expect(captionFor(real)).toEqual({ secondary: "#Real #film" });
  });

  it("keeps only characters the font subset has", () => {
    expect(
      captionFor({ ...real, tags: ["夜景", "night\n<b>"], platform: "Real" }),
    ).toEqual({ secondary: "#Real #night<b>" });
  });

  it("reads the platform under its old name from an older API", () => {
    const { platform: _, ...old } = real;
    expect(captionFor({ ...old, world: "Real" })).toEqual({
      secondary: "#Real #film",
    });
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
