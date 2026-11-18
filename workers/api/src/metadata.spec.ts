import { describe, expect, it } from "vitest";
import * as admin from "../../../admin/src/lib/metadata";
import {
  BUILTIN_DEFAULTS,
  EXIF_KEYS,
  exifAt,
  parseExif,
  effectiveLevels,
  METADATA_LEVELS,
  truncateTimestamp,
} from "./metadata";

describe("effectiveLevels", () => {
  it("takes the photo's level, else the site's, else the built-in one", () => {
    const levels = effectiveLevels(
      '{"taken_at":"date","camera":"manufacturer"}',
      '{"camera":"hidden"}',
    );
    expect(levels).toEqual({
      ...BUILTIN_DEFAULTS,
      taken_at: "date",
      camera: "hidden",
    });
    expect(effectiveLevels(null, null)).toEqual(BUILTIN_DEFAULTS);
  });

  it("treats an unknown value as hidden, and bad JSON as nothing set", () => {
    expect(effectiveLevels(null, '{"tags":"all"}').tags).toBe("hidden");
    expect(effectiveLevels("not json", "[1]")).toEqual(BUILTIN_DEFAULTS);
  });
});

describe("truncateTimestamp", () => {
  it("keeps the offset, also Z and negative ones", () => {
    expect(truncateTimestamp("2023-12-31T23:59:59Z", "date")).toBe(
      "2023-12-31T00:00:00Z",
    );
    expect(truncateTimestamp("2024-03-01T01:02:03-05:00", "month")).toBe(
      "2024-03-01T00:00:00-05:00",
    );
    expect(truncateTimestamp("2024-03-01T01:02-05:00", "minute")).toBe(
      "2024-03-01T01:02:00-05:00",
    );
  });

  it("gives nothing it cannot read below 'second'", () => {
    expect(truncateTimestamp("yesterday", "date")).toBeNull();
    expect(truncateTimestamp("2023-12-31", "year")).toBeNull();
    expect(truncateTimestamp("yesterday", "second")).toBe("yesterday");
    expect(truncateTimestamp(null, "second")).toBeNull();
  });
});

describe("the admin's copy", () => {
  it("has the same fields, levels and built-in defaults", () => {
    expect(admin.METADATA_LEVELS).toEqual(METADATA_LEVELS);
    expect(admin.BUILTIN_DEFAULTS).toEqual(BUILTIN_DEFAULTS);
  });
});

describe("exif", () => {
  it("has exactly the normalized keys", () => {
    expect(EXIF_KEYS).toEqual([
      "make",
      "model",
      "lens",
      "focal_length_mm",
      "f_number",
      "exposure_time",
      "iso",
      "orientation",
      "taken_at_original",
    ]);
  });

  it("reads only known keys of the right type", () => {
    expect(
      parseExif('{"iso":"100","f_number":2.8,"lens":"","x":1,"make":"Canon"}'),
    ).toEqual({ f_number: 2.8, make: "Canon" });
    expect(parseExif("nope")).toEqual({});
    expect(exifAt('{"lens":"L"}', "basic")).toBeNull();
  });
});
