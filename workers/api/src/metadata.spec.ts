import { describe, expect, it } from "vitest";
import * as admin from "../../../admin/src/lib/metadata";
import {
  BUILTIN_DEFAULTS,
  EXIF_KEYS,
  exifAt,
  parseExif,
  effectiveLevels,
  locationAt,
  METADATA_LEVELS,
  truncateTimestamp,
} from "./metadata";
import { LOCATION_DECIMALS } from "../../../shared/map/map";

describe("locationAt", () => {
  it("rounds to each level's decimals, at the boundaries too", () => {
    const at = (lat: number, lng: number, level: "exact" | "city" | "prefecture" | "country") =>
      locationAt(lat, lng, level);
    expect(at(35.681236, 139.767125, "exact")).toEqual({
      latitude: 35.68124,
      longitude: 139.76713,
      precision: "exact",
    });
    expect(at(35.685, 139.765, "city")?.latitude).toBe(35.69);
    expect(at(-0.04, -0.04, "prefecture")).toEqual({
      latitude: 0,
      longitude: 0,
      precision: "prefecture",
    });
    expect(Object.is(at(-0.04, -0.04, "prefecture")?.latitude, -0)).toBe(false);
    expect(at(-35.5, 179.5, "country")).toEqual({
      latitude: -35,
      longitude: 180,
      precision: "country",
    });
  });

  it("is null when hidden or not known", () => {
    expect(locationAt(35, 139, "hidden")).toBeNull();
    expect(locationAt(null, 139, "exact")).toBeNull();
    expect(locationAt(35, null, "exact")).toBeNull();
  });

  it("uses the decimals the map draws areas for", () => {
    // shared/map/map.ts sizes the approximate areas by these.
    for (const [level, d] of Object.entries(LOCATION_DECIMALS)) {
      const r = locationAt(1 / 3, 1 / 3, level as "exact");
      expect(r?.latitude).toBe(Math.round((1 / 3) * 10 ** d) / 10 ** d);
    }
  });
});

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
    expect(
      exifAt('{"lens":"L"}', "basic", { camera: "model", taken_at: "second" }),
    ).toBeNull();
  });
});
