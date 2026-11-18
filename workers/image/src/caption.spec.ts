import { describe, expect, it } from "vitest";
import {
  captionFor,
  formatLocal,
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

describe("formatLocal", () => {
  it("keeps the photo's own clock and names its offset", () => {
    expect(formatLocal("2023-12-16T23:12:25.684+09:00")).toBe(
      "2023-12-16 23:12 JST",
    );
    // Not converted to JST: the same reading as the gallery shows.
    expect(formatLocal("2023-12-01T15:30:00Z")).toBe("2023-12-01 15:30 UTC");
    expect(formatLocal("2023-12-01T15:30:00-05:00")).toBe(
      "2023-12-01 15:30 UTC-05:00",
    );
    expect(formatLocal("2023-12-01T15:30:00")).toBe("2023-12-01 15:30");
  });

  it("is null for missing or invalid timestamps", () => {
    expect(formatLocal(null)).toBeNull();
    expect(formatLocal("not a date")).toBeNull();
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

  it("shows the time only as precisely as the API gives it", () => {
    const at = (timestamp: string, timestamp_precision: string) =>
      captionFor({ ...real, timestamp, timestamp_precision }).primary;
    expect(at("2023-12-16T23:12:00+09:00", "minute")).toBe(
      "2023-12-16 23:12 JST",
    );
    // Cut down in the photo's own offset: no shift into JST.
    expect(at("2023-12-16T00:00:00-05:00", "date")).toBe("2023-12-16");
    expect(at("2023-12-01T00:00:00+09:00", "month")).toBe("2023-12");
    expect(at("2023-01-01T00:00:00+09:00", "year")).toBe("2023");
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
