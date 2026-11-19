import { describe, it, expect } from "vitest";
import {
  formatTaken,
  parseLocation,
  parseMediaItem,
  parseMediaList,
  parseMediaTimestamp,
  parseTagFields,
  transformMediaInfo,
} from "./types";

describe("parseTagFields", () => {
  it("keeps well-formed fields as text, numbers as written", () => {
    expect(
      parseTagFields([
        { tag: "フィルム", label: "銘柄", value: "Portra 400" },
        { tag: "フィルム", label: "ISO", value: 400 },
        { tag: "フィルム", label: "x", value: "" },
        { tag: "フィルム", label: "y", value: Number.NaN },
        { tag: "", label: "z", value: "a" },
        "nope",
      ]),
    ).toEqual([
      { tag: "フィルム", label: "銘柄", value: "Portra 400" },
      { tag: "フィルム", label: "ISO", value: "400" },
    ]);
    expect(parseTagFields(null)).toEqual([]);
  });
});
import type { MediaInfoJSON } from "./types";

describe("parseMediaTimestamp", () => {
  it("should return null for null input", () => {
    expect(parseMediaTimestamp(null)).toBeNull();
  });

  it("should return null for invalid date string", () => {
    expect(parseMediaTimestamp("invalid-date")).toBeNull();
  });

  it("should return Date object for valid ISO 8601 string", () => {
    const result = parseMediaTimestamp("2023-12-01T00:00:00Z");
    expect(result).toBeInstanceOf(Date);
  });
});

const item: MediaInfoJSON = {
  id: "abcdefghjk",
  file: "/media/test.jpg",
  path: null,
  platform: "Real",
  name: null,
  timestamp: "2023-12-01T00:00:00Z",
  timestamp_precision: null,
  camera: null,
  maker: null,
  digitizer: null,
  digitizerMaker: null,
  digitized_at: null,
  digitized_at_precision: null,
  world: null,
  exif: null,
  location: null,
  tags: [],
  tag_fields: [],
};

describe("formatTaken", () => {
  it("says only as much as the API gives, in the photo's own date", () => {
    const at = "2023-12-16T00:00:00+09:00";
    expect(formatTaken(at, "year")).toBe("2023");
    expect(formatTaken(at, "month")).toBe("2023/12");
    expect(formatTaken("2023-12-16T00:00:00-05:00", "date")).toBe(
      "2023/12/16",
    );
    expect(formatTaken(null, "date")).toBeNull();
    expect(formatTaken("nope", "date")).toBeNull();
  });

  it("gives the time to the minute in the photo's own offset", () => {
    const t = "2023-12-16T23:12:53+09:00";
    expect(formatTaken(t, "second")).toBe("2023/12/16 23:12");
    expect(formatTaken(t, null)).toBe("2023/12/16 23:12");
    expect(formatTaken(t, "minute")).toBe("2023/12/16 23:12");
    // Not the viewer's (or Tokyo's) time zone.
    expect(formatTaken("2023-12-01T00:00:00Z", "second")).toBe(
      "2023/12/01 00:00",
    );
  });
});

describe("transformMediaInfo", () => {
  it("should transform timestamp string to Date", () => {
    expect(transformMediaInfo(item).timestamp).toBeInstanceOf(Date);
  });

  it("should preserve null timestamp", () => {
    expect(
      transformMediaInfo({ ...item, timestamp: null }).timestamp,
    ).toBeNull();
  });

  it("should handle invalid timestamp by returning null", () => {
    expect(
      transformMediaInfo({ ...item, timestamp: "not-a-date" }).timestamp,
    ).toBeNull();
  });
});

describe("parseMediaItem", () => {
  it("accepts a photo from the API", () => {
    const camera = {
      slug: "virtuallens2",
      name: "VirtualLens2",
      manufacturer: "logilabo",
      model: "VirtualLens2",
    };
    expect(parseMediaItem({ ...item, camera, tags: ["a"] })).toEqual({
      ...item,
      camera,
      tags: ["a"],
    });
  });

  it("reads the precision and a maker-only camera", () => {
    expect(
      parseMediaItem({
        ...item,
        name: "test.jpg",
        timestamp_precision: "month",
        camera: { slug: null, name: "logilabo", manufacturer: "logilabo", model: null },
      }),
    ).toEqual({
      ...item,
      name: "test.jpg",
      timestamp_precision: "month",
      maker: "logilabo",
    });
    expect(
      parseMediaItem({ ...item, timestamp_precision: "fortnight" })
        ?.timestamp_precision,
    ).toBeNull();
  });

  it("reads the world, exif, location and path", () => {
    expect(
      parseMediaItem({
        ...item,
        path: "/2023/test.jpg",
        world: { id: "wrld_0a-b", name: "Home" },
        exif: {
          make: "Canon",
          lens: "",
          f_number: 2.8,
          iso: "100",
          exposure_time: "1/250",
          focal_length_mm: Infinity,
          taken_at_original: "2023-12-01T09:00:00+09:00",
        },
        location: { latitude: 35.68, longitude: 139.77, precision: "city" },
      }),
    ).toEqual({
      ...item,
      path: "/2023/test.jpg",
      world: { id: "wrld_0a-b", name: "Home" },
      // Only known keys of the right type; never the original time.
      exif: { make: "Canon", f_number: 2.8, exposure_time: "1/250" },
      location: { latitude: 35.68, longitude: 139.77, precision: "city" },
    });
  });

  it("drops a world id that is not one, and empty or odd objects", () => {
    const p = (v: Record<string, unknown>) => parseMediaItem({ ...item, ...v });
    expect(p({ world: { id: "../x", name: "Home" } })?.world).toEqual({
      id: null,
      name: "Home",
    });
    expect(p({ world: { name: null } })?.world).toBeNull();
    expect(p({ exif: {} })?.exif).toBeNull();
    expect(p({ exif: [] })?.exif).toBeNull();
    expect(
      p({ location: { latitude: 91, longitude: 0, precision: "exact" } })
        ?.location,
    ).toBeNull();
    expect(
      p({ location: { latitude: 1, longitude: 2, precision: "street" } })
        ?.location,
    ).toBeNull();
  });

  it("needs platform (no old name)", () => {
    const old: Record<string, unknown> = { ...item, world: "Real" };
    delete old.platform;
    expect(parseMediaItem(old)).toBeNull();
  });

  it("accepts a photo whose file name is not public", () => {
    expect(parseMediaItem({ ...item, file: null })).toEqual({
      ...item,
      file: null,
    });
    expect(parseMediaItem({ ...item, file: undefined })).toBeNull();
  });

  it("rejects ids and files that would not be safe in a URL", () => {
    expect(parseMediaItem({ ...item, id: "../x" })).toBeNull();
    expect(parseMediaItem({ ...item, id: "abcdefghjo" })).toBeNull();
    expect(parseMediaItem({ ...item, file: "/a/../b.png" })).toBeNull();
    expect(parseMediaItem({ ...item, file: "https://x/a.png" })).toBeNull();
    expect(parseMediaItem({ ...item, platform: "Mars" })).toBeNull();
    expect(parseMediaItem(null)).toBeNull();
  });

  it("drops malformed optional fields", () => {
    expect(
      parseMediaItem({
        ...item,
        timestamp: 3,
        camera: { name: "no slug" },
        tags: ["a", 1],
      }),
    ).toEqual({
      ...item,
      timestamp: null,
      camera: null,
      maker: "no slug",
      tags: ["a"],
    });
  });
});

describe("parseMediaItem: the スキャン機材", () => {
  it("reads the device and its date, at their levels", () => {
    expect(
      parseMediaItem({
        ...item,
        digitizer: {
          slug: "gcmc-scanner",
          name: "Scanner",
          manufacturer: "GCMC",
          model: "Scanner",
        },
        digitized_at: "2021-01-01T00:00:00+09:00",
        digitized_at_precision: "date",
      }),
    ).toMatchObject({
      digitizer: {
        slug: "gcmc-scanner",
        name: "Scanner",
        manufacturer: "GCMC",
        model: "Scanner",
      },
      digitizerMaker: null,
      digitized_at: "2021-01-01T00:00:00+09:00",
      digitized_at_precision: "date",
    });
    // The maker only; a date without a known precision is dropped.
    expect(
      parseMediaItem({
        ...item,
        digitizer: { slug: null, name: "GCMC", manufacturer: "GCMC" },
        digitized_at: "2021-01-01T00:00:00+09:00",
        digitized_at_precision: "fortnight",
      }),
    ).toMatchObject({
      digitizer: null,
      digitizerMaker: "GCMC",
      digitized_at: null,
      digitized_at_precision: null,
    });
  });
});

describe("parseMediaList", () => {
  it("keeps the valid photos of an array", () => {
    expect(parseMediaList([item, { id: 1 }])).toEqual([item]);
    expect(parseMediaList({ media: [] })).toEqual([]);
  });
});

describe("parseLocation", () => {
  it("keeps a valid position, rounded to its precision", () => {
    expect(
      parseLocation({ latitude: 35.6812, longitude: 139.7671, precision: "city" }),
    ).toEqual({ latitude: 35.68, longitude: 139.77, precision: "city" });
    // Rounding at the boundaries: -0 becomes 0, and a half rounds up.
    expect(
      parseLocation({ latitude: -0.004, longitude: 0.05, precision: "prefecture" }),
    ).toEqual({ latitude: 0, longitude: 0.1, precision: "prefecture" });
    expect(
      parseLocation({ latitude: 89.6, longitude: -179.6, precision: "country" }),
    ).toEqual({ latitude: 90, longitude: -180, precision: "country" });
  });

  it("drops anything else", () => {
    for (const v of [
      null,
      "35,139",
      { latitude: 35, longitude: 139 },
      { latitude: 35, longitude: 139, precision: "street" },
      { latitude: 91, longitude: 139, precision: "exact" },
      { latitude: "35", longitude: 139, precision: "exact" },
    ]) {
      expect(parseLocation(v)).toBeNull();
    }
  });

  it("is on a parsed photo only when public", () => {
    const base = {
      id: "abcdefghjk",
      file: null,
      platform: "Real",
      timestamp: null,
      camera: null,
      tags: [],
    };
    expect(parseMediaItem(base)?.location).toBeNull();
    // Never for a VRChat photo, whatever the API says.
    expect(
      parseMediaItem({
        ...base,
        platform: "VRChat",
        location: { latitude: 35, longitude: 139, precision: "exact" },
      })?.location,
    ).toBeNull();
    expect(
      parseMediaItem({
        ...base,
        location: { latitude: 35, longitude: 139, precision: "exact" },
      })?.location,
    ).toEqual({ latitude: 35, longitude: 139, precision: "exact" });
  });
});
