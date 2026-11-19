import { describe, expect, it } from "vitest";
import {
  applyReading,
  mayReplace,
  parseSources,
  type Reading,
  type SourcedRow,
} from "./metadata-source";

describe("mayReplace", () => {
  // stored → incoming → replaced?
  const table: [string | undefined, string, boolean][] = [
    // taken_at: manual > exif > xmp > filename > file_date
    [undefined, "file_date", true],
    ["filename", "xmp", true],
    ["filename", "filename", true],
    ["filename", "file_date", false],
    ["xmp", "exif", true],
    ["xmp", "filename", false],
    ["exif", "xmp", false],
    ["exif", "exif", true],
    ["manual", "exif", false],
    // exif / world / location: manual > file
    [undefined, "file", true],
    ["file", "file", true],
    ["exif", "file", true], // location_source 'exif'
    ["manual", "file", false],
  ];
  it.each(table)("%s ← %s: %s", (stored, incoming, expected) => {
    expect(mayReplace(stored, incoming)).toBe(expected);
  });
});

describe("parseSources", () => {
  it("keeps only known fields and values", () => {
    expect(
      parseSources(
        '{"taken_at":"xmp","exif":"manual","world":"bogus","x":"file"}',
      ),
    ).toEqual({ taken_at: "xmp", exif: "manual" });
    expect(parseSources("not json")).toEqual({});
    expect(parseSources(null)).toEqual({});
  });
});

describe("applyReading", () => {
  const row: SourcedRow = {
    timestamp: "2026-11-02T11:31:36.000+09:00",
    exif: null,
    latitude: null,
    longitude: null,
    location_source: null,
    world_id: "wrld_mine",
    world_name: "Mine",
    world_author_id: null,
    metadata_source: '{"taken_at":"filename","world":"manual"}',
    file_exif: null,
    digitized_at: null,
  };
  const reading: Reading = {
    takenAt: { at: "2026-11-02T11:31:36.959+09:00", source: "xmp" },
    exif: { make: "X" },
    fileExif: { make: "X", software: "S" },
    digitizedAt: null,
    location: { latitude: 1, longitude: 2 },
    world: { id: "wrld_file", name: "File", authorId: "usr_a" },
  };

  it("takes a location only on a first read, or over one from EXIF", () => {
    expect(applyReading(row, reading).latitude).toBeNull();
    expect(applyReading(row, reading, true).latitude).toBe(1);
    expect(
      applyReading(
        { ...row, latitude: 9, longitude: 9, location_source: "exif" },
        reading,
      ).latitude,
    ).toBe(1);
    expect(
      applyReading({ ...row, location_source: "manual" }, reading, true)
        .latitude,
    ).toBeNull();
  });

  it("upgrades what it may and leaves manual values alone", () => {
    const out = applyReading(row, reading, true);
    expect(out).toMatchObject({
      timestamp: "2026-11-02T11:31:36.959+09:00",
      exif: '{"make":"X"}',
      latitude: 1,
      longitude: 2,
      location_source: "exif",
      world_id: "wrld_mine",
      world_name: "Mine",
    });
    expect(parseSources(out.metadata_source)).toEqual({
      taken_at: "xmp",
      exif: "file",
      world: "manual",
    });
  });

  it("never clears a value because nothing was read", () => {
    const out = applyReading(row, {
      takenAt: null,
      exif: null,
      fileExif: null,
      digitizedAt: null,
      location: null,
      world: null,
    });
    expect(out).toEqual(row);
  });

  it("takes a scanner's automatic EXIF off the shooting info, never a manual one", () => {
    const scan: Reading = {
      takenAt: null,
      exif: null,
      fileExif: { make: "GCMC", model: "Scanner" },
      digitizedAt: null,
      location: null,
      world: null,
    };
    const old = { ...row, exif: '{"make":"GCMC","model":"Scanner"}' };
    const auto = applyReading(
      { ...old, metadata_source: '{"exif":"file"}' },
      scan,
    );
    expect(auto.exif).toBeNull();
    expect(parseSources(auto.metadata_source)).toEqual({});
    const manual = applyReading(
      { ...old, metadata_source: '{"exif":"manual"}' },
      scan,
    );
    expect(manual.exif).toBe(old.exif);
    // A camera's file read with nothing: nothing cleared.
    expect(
      applyReading(
        { ...old, metadata_source: '{"exif":"file"}' },
        { ...scan, fileExif: { make: "FUJIFILM", model: "X-T5" } },
      ).exif,
    ).toBe(old.exif);
  });

  it("keeps a scanner's EXIF and time apart, never as shooting info", () => {
    const out = applyReading(
      { ...row, metadata_source: null },
      {
        takenAt: null,
        exif: null,
        fileExif: {
          make: "GCMC",
          model: "Scanner",
          taken_at_original: "2021-01-01T00:31:12",
        },
        digitizedAt: "2021-01-01T00:31:12+09:00",
        location: null,
        world: null,
      },
    );
    expect(out).toMatchObject({
      timestamp: row.timestamp,
      exif: null,
      file_exif:
        '{"make":"GCMC","model":"Scanner","taken_at_original":"2021-01-01T00:31:12"}',
      digitized_at: "2021-01-01T00:31:12+09:00",
    });
  });
});
