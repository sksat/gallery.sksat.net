import { describe, expect, it } from "vitest";
import {
  commonLevels,
  storedOverrides,
  validateLevelChange,
  withLevels,
} from "./bulk-metadata";

describe("commonLevels", () => {
  it("gives the shared level, '' for the default, null when they differ", () => {
    const c = commonLevels([
      { camera: "hidden", taken_at: "date" },
      { camera: "hidden" },
    ]);
    expect(c.camera).toBe("hidden");
    expect(c.taken_at).toBeNull();
    expect(c.file_name).toBe("");
    expect(c.exif).toBe("");
  });
});

describe("withLevels", () => {
  it("sets levels, removes the ones set to the default, keeps the rest", () => {
    expect(
      withLevels(
        { camera: "hidden", taken_at: "date", exif: "hidden" },
        { camera: "", taken_at: "year", world: "name" },
      ),
    ).toEqual({ taken_at: "year", exif: "hidden", world: "name" });
  });
});

describe("storedOverrides", () => {
  it("is NULL for none and JSON in the fields' order otherwise", () => {
    expect(storedOverrides({})).toBeNull();
    expect(storedOverrides({ exif: "hidden", file_name: "name" })).toBe(
      '{"file_name":"name","exif":"hidden"}',
    );
  });
});

describe("validateLevelChange", () => {
  it("accepts levels and '' for every field", () => {
    expect(validateLevelChange({ exif: "all", location: "" })).toEqual({
      ok: true,
      value: { exif: "all", location: "" },
    });
  });

  it("refuses unknown fields, wrong levels and an empty change", () => {
    expect(validateLevelChange({ colour: "red" }).ok).toBe(false);
    expect(validateLevelChange({ camera: "second" }).ok).toBe(false);
    expect(validateLevelChange({}).ok).toBe(false);
    expect(validateLevelChange([]).ok).toBe(false);
  });
});
