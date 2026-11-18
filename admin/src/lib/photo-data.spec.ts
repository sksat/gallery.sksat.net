import { describe, expect, it } from "vitest";
import {
  changedGroups,
  formGroups,
  rowFormValues,
  formatExposureLine,
  formatGear,
  mergeExif,
  validateExifEdit,
  validateLocationEdit,
  validateWorldEdit,
  worldUrl,
} from "./photo-data";

describe("validateExifEdit", () => {
  it("reads form strings, clearing blanks", () => {
    expect(
      validateExifEdit({
        make: " Sony ",
        model: "",
        f_number: "2.8",
        iso: "400",
        exposure_time: "1/250",
        focal_length_mm: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        make: "Sony",
        model: null,
        f_number: 2.8,
        iso: 400,
        exposure_time: "1/250",
        focal_length_mm: null,
      },
    });
  });

  it("refuses unknown keys, bad values and other types", () => {
    for (const bad of [
      { orientation: "6" },
      { f_number: "-1" },
      { f_number: "0x10" },
      { iso: "lots" },
      { exposure_time: "fast" },
      { make: "x".repeat(201) },
      { make: true },
      { iso: {} },
      [],
    ]) {
      expect(validateExifEdit(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("mergeExif", () => {
  it("sets and clears the keys given and keeps every other one", () => {
    const current = JSON.stringify({
      make: "Old",
      lens: "L",
      orientation: 6,
      taken_at_original: "2023-12-11T01:21:32+09:00",
    });
    expect(JSON.parse(mergeExif(current, { make: "New" })!)).toEqual({
      make: "New",
      lens: "L",
      orientation: 6,
      taken_at_original: "2023-12-11T01:21:32+09:00",
    });
    expect(JSON.parse(mergeExif(current, { lens: null })!)).toEqual({
      make: "Old",
      orientation: 6,
      taken_at_original: "2023-12-11T01:21:32+09:00",
    });
    expect(mergeExif(null, {})).toBeNull();
    expect(mergeExif('{"make":"x"}', { make: null })).toBeNull();
  });
});

describe("changedGroups", () => {
  const values = {
    exif_make: "FUJIFILM",
    latitude: "35.5",
    longitude: "139.5",
    world_name: "A\nB",
  } as Record<string, string>;
  const loaded = formGroups((n) => values[n]);

  it("finds only the groups edited since loading", () => {
    // A text input drops the line break: still unchanged.
    const same: Record<string, string> = { ...values, world_name: "AB" };
    expect(
      changedGroups(
        loaded,
        formGroups((n) => same[n]),
      ),
    ).toEqual([]);
    const edited: Record<string, string> = { ...values, latitude: "35.6" };
    expect(
      changedGroups(
        loaded,
        formGroups((n) => edited[n]),
      ),
    ).toEqual(["location"]);
  });

  it("round-trips a row's values", () => {
    const row = {
      exif: { make: "X", f_number: 2.8, iso: 400 },
      latitude: 35.6587083,
      longitude: -139.7447,
      world_id: null,
      world_name: "W",
    };
    const v = rowFormValues(row);
    expect(v).toMatchObject({
      exif_make: "X",
      exif_f_number: "2.8",
      exif_lens: "",
      latitude: "35.6587083",
      world_id: "",
    });
    expect(
      validateLocationEdit({ latitude: v.latitude, longitude: v.longitude }),
    ).toEqual({
      ok: true,
      value: { latitude: 35.6587083, longitude: -139.7447 },
    });
  });
});

describe("validateLocationEdit", () => {
  it("needs both or neither", () => {
    expect(
      validateLocationEdit({ latitude: "35.5", longitude: " 139.7" }),
    ).toEqual({ ok: true, value: { latitude: 35.5, longitude: 139.7 } });
    expect(validateLocationEdit({ latitude: "", longitude: "" })).toEqual({
      ok: true,
      value: null,
    });
    expect(validateLocationEdit(null)).toEqual({ ok: true, value: null });
    for (const bad of [
      { latitude: "35", longitude: "" },
      { latitude: "91", longitude: "0" },
      { latitude: "0", longitude: "181" },
      { latitude: "x", longitude: "1" },
      { latitude: "0x10", longitude: "1" },
      { latitude: true, longitude: true },
      {},
    ]) {
      expect(validateLocationEdit(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("validateWorldEdit", () => {
  it("takes a wrld_ id and a name", () => {
    expect(validateWorldEdit({ id: "wrld_abc-1", name: " W " })).toEqual({
      ok: true,
      value: { id: "wrld_abc-1", name: "W" },
    });
    expect(validateWorldEdit({ id: "", name: "" })).toEqual({
      ok: true,
      value: { id: null, name: null },
    });
    expect(validateWorldEdit({ id: "usr_x" }).ok).toBe(false);
    expect(validateWorldEdit({ id: 123 }).ok).toBe(false);
  });

  it("keeps the part left out", () => {
    expect(validateWorldEdit({ name: "W" })).toEqual({
      ok: true,
      value: { name: "W" },
    });
  });
});

describe("format", () => {
  it("writes the gear and exposure lines", () => {
    const e = {
      make: "FUJIFILM",
      model: "X-T5",
      lens: "XF35mmF1.4 R",
      focal_length_mm: 35,
      f_number: 2.8,
      exposure_time: "1/250",
      iso: 400,
    };
    expect(formatGear(e)).toBe("FUJIFILM X-T5 · XF35mmF1.4 R");
    expect(formatExposureLine(e)).toBe("35mm · f/2.8 · 1/250 秒 · ISO 400");
    expect(formatGear({})).toBe("");
    expect(worldUrl("wrld_a")).toBe("https://vrchat.com/home/world/wrld_a");
  });
});
