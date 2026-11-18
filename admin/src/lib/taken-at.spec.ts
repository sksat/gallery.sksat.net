import { describe, expect, it } from "vitest";
import { exifDateToIso, exifTakenAt, vrchatTakenAt } from "./taken-at";

/**
 * A TIFF block: IFD0 with `ifd0` ASCII tags (and a pointer to the EXIF IFD
 * when `exif` is given), then the EXIF IFD, then the strings.
 */
const tiff = (
  little: boolean,
  ifd0: Record<number, string>,
  exif?: Record<number, string>,
): Uint8Array => {
  const ifd0Tags = Object.entries(ifd0).map(
    ([t, v]) => [Number(t), v] as const,
  );
  const exifTags = exif
    ? Object.entries(exif).map(([t, v]) => [Number(t), v] as const)
    : [];
  const ifd0Count = ifd0Tags.length + (exif ? 1 : 0);
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Count);
  let dataAt = exifAt + (exif ? ifdSize(exifTags.length) : 0);
  const buf = new ArrayBuffer(dataAt + 256);
  const v = new DataView(buf);
  v.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  v.setUint16(2, 42, little);
  v.setUint32(4, ifd0At, little);
  const writeIfd = (
    at: number,
    tags: (readonly [number, string])[],
    pointer: number | null,
  ) => {
    const all: [number, number, number, number | string][] = tags.map(
      ([t, s]) => [t, 2, s.length + 1, s],
    );
    if (pointer !== null) all.push([0x8769, 4, 1, pointer]);
    all.sort((a, b) => a[0] - b[0]);
    v.setUint16(at, all.length, little);
    all.forEach(([tag, type, n, value], i) => {
      const e = at + 2 + i * 12;
      v.setUint16(e, tag, little);
      v.setUint16(e + 2, type, little);
      v.setUint32(e + 4, n, little);
      if (typeof value === "number") {
        v.setUint32(e + 8, value, little);
      } else {
        v.setUint32(e + 8, dataAt, little);
        for (let j = 0; j < value.length; j++) {
          v.setUint8(dataAt + j, value.charCodeAt(j));
        }
        dataAt += value.length + 1;
      }
    });
  };
  writeIfd(ifd0At, ifd0Tags, exif ? exifAt : null);
  if (exif) writeIfd(exifAt, exifTags, null);
  return new Uint8Array(buf, 0, dataAt);
};

const concat = (...parts: (Uint8Array | number[])[]): ArrayBuffer => {
  const arrays = parts.map((p) =>
    p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out.buffer;
};

const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [
  n >>> 24,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A JPEG: SOI, an APP0, the EXIF APP1, then SOS. */
const jpeg = (t: Uint8Array) =>
  concat(
    [0xff, 0xd8],
    [0xff, 0xe0, ...u16(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1, ...u16(2 + 6 + t.length), ...ascii("Exif"), 0, 0],
    t,
    [0xff, 0xda, 0, 2],
  );

/** A PNG: signature, IHDR, an eXIf chunk, IDAT (CRCs are not checked). */
const png = (t: Uint8Array) =>
  concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    [...u32(13), ...ascii("IHDR"), ...new Array(13).fill(0), 0, 0, 0, 0],
    [...u32(t.length), ...ascii("eXIf")],
    t,
    [0, 0, 0, 0],
    [...u32(0), ...ascii("IDAT"), 0, 0, 0, 0],
  );

describe("vrchatTakenAt", () => {
  it("reads VRChat's file names as JST", () => {
    expect(vrchatTakenAt("VRChat_2026-11-18_01-02-03.456_3840x2160.png")).toBe(
      "2026-11-18T01:02:03.456+09:00",
    );
  });

  it("ignores other names and impossible dates", () => {
    expect(vrchatTakenAt("IMG_0001.jpg")).toBeNull();
    expect(
      vrchatTakenAt("VRChat_2026-11-18_01-02-03.456_3840x2160.jpg"),
    ).toBeNull();
    expect(
      vrchatTakenAt("VRChat_2026-02-30_01-02-03.456_3840x2160.png"),
    ).toBeNull();
    expect(
      vrchatTakenAt("VRChat_2026-11-18_25-02-03.456_3840x2160.png"),
    ).toBeNull();
  });
});

describe("exifDateToIso", () => {
  it("uses the offset when given, JST otherwise", () => {
    expect(exifDateToIso("2023:12:11 01:21:32", "-05:00")).toBe(
      "2023-12-11T01:21:32-05:00",
    );
    expect(exifDateToIso("2023:12:11 01:21:32", null)).toBe(
      "2023-12-11T01:21:32+09:00",
    );
    expect(exifDateToIso("2023:12:11 01:21:32", "junk")).toBe(
      "2023-12-11T01:21:32+09:00",
    );
  });

  it("refuses blanks and impossible dates", () => {
    expect(exifDateToIso("    :  :     :  :  ", null)).toBeNull();
    expect(exifDateToIso("0000:00:00 00:00:00", null)).toBeNull();
    expect(exifDateToIso("2023:13:01 00:00:00", null)).toBeNull();
  });
});

describe("exifTakenAt", () => {
  const ORIGINAL = { 0x9003: "2023:12:11 01:21:32", 0x9011: "+09:00" };

  it("reads DateTimeOriginal and its offset from a JPEG (both byte orders)", () => {
    for (const little of [true, false]) {
      expect(
        exifTakenAt(
          jpeg(tiff(little, { 0x0132: "2024:01:01 00:00:00" }, ORIGINAL)),
        ),
      ).toBe("2023-12-11T01:21:32+09:00");
    }
  });

  it("reads only the date tags, and only their first bytes", () => {
    const t = tiff(
      true,
      { 0x010e: "a description", 0x010f: "Maker" },
      {
        0x9003: `2023:12:11 01:21:32${" pad".repeat(40)}`,
      },
    );
    expect(exifTakenAt(jpeg(t))).toBe("2023-12-11T01:21:32+09:00");
  });

  it("falls back to IFD0 DateTime", () => {
    expect(
      exifTakenAt(jpeg(tiff(true, { 0x0132: "2024:01:02 03:04:05" }))),
    ).toBe("2024-01-02T03:04:05+09:00");
  });

  it("reads a PNG eXIf chunk", () => {
    expect(
      exifTakenAt(png(tiff(false, {}, { 0x9003: "2025:06:07 08:09:10" }))),
    ).toBe("2025-06-07T08:09:10+09:00");
  });

  it("returns null without metadata, for other files and for truncated data", () => {
    expect(exifTakenAt(jpeg(tiff(true, {})))).toBeNull();
    expect(exifTakenAt(new TextEncoder().encode("hello").buffer)).toBeNull();
    expect(exifTakenAt(new ArrayBuffer(0))).toBeNull();
    const whole = new Uint8Array(jpeg(tiff(true, {}, ORIGINAL)));
    expect(exifTakenAt(whole.slice(0, 40).buffer)).toBeNull();
  });
});
