/**
 * The public EXIF: tags from the projected metadata (publicExif), the
 * TIFF writer (encodeTiff) and the container edits (embedExif), read back
 * by exifr, an independent parser. The fixtures are tiny images written
 * by Pillow (fixtures/make-fixtures.py).
 */
import { readFileSync } from "node:fs";
import exifr from "exifr";
import { describe, expect, it } from "vitest";
import { embedExif, embedJpeg, embedWebp } from "./exif-embed";
import { encodeTiff, TAG, type ExifIfds } from "./exif-encode";
import {
  digitizerText,
  exifDateTime,
  exposureRational,
  publicExif,
  type PublicMeta,
  userComment,
} from "./public-exif";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** Every tag exifr finds, by its tag number (no value translation). */
const readTiff = async (tiff: Uint8Array) =>
  (await exifr.parse(Buffer.from(tiff), {
    tiff: true,
    ifd0: {},
    exif: true,
    gps: true,
    translateKeys: false,
    translateValues: false,
    reviveValues: false,
    sanitize: false,
    mergeOutput: false,
  })) as Record<string, Record<number, unknown>>;

const FULL: PublicMeta = {
  timestamp: "2026-11-18T01:02:03+09:00",
  timestamp_precision: "second",
  camera: { slug: "x-t5", manufacturer: "FUJIFILM", model: "X-T5" },
  exif: {
    lens: "XF35mmF1.4 R",
    f_number: 2.8,
    exposure_time: "1/250",
    iso: 400,
    focal_length_mm: 35,
  },
  location: { latitude: 35.65871, longitude: -139.74471, precision: "exact" },
  world: { id: "wrld_x", name: "ネコの集会所" },
};

describe("publicExif → encodeTiff", () => {
  it("writes every public field, readable by exifr", async () => {
    const tiff = encodeTiff(publicExif(FULL))!;
    const got = await readTiff(tiff);
    expect(got.ifd0[TAG.make]).toBe("FUJIFILM");
    expect(got.ifd0[TAG.model]).toBe("X-T5");
    // UTF-8 in an ASCII field (exifr does not decode it; exiftool and
    // Pillow read these bytes back as written).
    expect(got.ifd0[TAG.imageDescription]).toBeDefined();
    expect(Buffer.from(tiff).includes(Buffer.from("ネコの集会所\0"))).toBe(
      true,
    );
    expect(got.exif[TAG.lensModel]).toBe("XF35mmF1.4 R");
    expect(got.exif[TAG.dateTimeOriginal]).toBe("2026:11:18 01:02:03");
    expect(got.exif[TAG.offsetTimeOriginal]).toBe("+09:00");
    expect(got.exif[TAG.fNumber]).toBeCloseTo(2.8);
    expect(got.exif[TAG.exposureTime]).toBeCloseTo(1 / 250);
    expect(got.exif[TAG.iso]).toBe(400);
    expect(got.exif[TAG.focalLength]).toBe(35);
    expect(got.gps[TAG.gpsLatitudeRef]).toBe("N");
    expect(got.gps[TAG.gpsLatitude]).toEqual([35.65871, 0, 0]);
    expect(got.gps[TAG.gpsLongitudeRef]).toBe("W");
    expect(got.gps[TAG.gpsLongitude]).toEqual([139.74471, 0, 0]);
  });

  it("writes nothing when nothing is public", () => {
    expect(encodeTiff(publicExif({}))).toBeNull();
    expect(
      encodeTiff(
        publicExif({
          timestamp: null,
          timestamp_precision: null,
          camera: null,
          exif: null,
          location: null,
          world: null,
        }),
      ),
    ).toBeNull();
  });

  it("takes Make/Model from the registered camera only, never the file's EXIF", () => {
    // A film scan: the file's EXIF names the lab's scanner, and the API
    // returns it at the "all" exif level. It must not pass as the camera.
    const scan = publicExif({
      camera: null,
      exif: {
        make: "FUJI PHOTO FILM CO., LTD.",
        model: "SP-2000",
      } as PublicMeta["exif"],
    });
    expect(scan.ifd0.has(TAG.make)).toBe(false);
    expect(scan.ifd0.has(TAG.model)).toBe(false);
    const film = publicExif({
      camera: { slug: "fm2", manufacturer: "Nikon", model: "FM2" },
      exif: { make: "NORITSU KOKI", model: "QSS-32" } as PublicMeta["exif"],
    });
    expect(film.ifd0.get(TAG.make)).toEqual({ type: "ascii", value: "Nikon" });
    expect(film.ifd0.get(TAG.model)).toEqual({ type: "ascii", value: "FM2" });
  });

  it("puts the スキャン機材 in UserComment and its date in DateTimeDigitized", async () => {
    const ifds = publicExif({
      camera: { slug: "fm2", manufacturer: "Nikon", model: "FM2" },
      digitizer: { manufacturer: "GCMC", model: "Scanner" },
      digitized_at: "2021-01-01T00:31:12+09:00",
      digitized_at_precision: "date",
    });
    const got = await readTiff(encodeTiff(ifds)!);
    // Make / Model stay the shooting camera.
    expect(got.ifd0[TAG.make]).toBe("Nikon");
    expect(got.ifd0[TAG.model]).toBe("FM2");
    // At "date": the time blanked (exifr trims the trailing spaces).
    expect(String(got.exif[TAG.dateTimeDigitized]).trimEnd()).toBe(
      "2021:01:01   :  :",
    );
    expect(got.exif[TAG.offsetTimeDigitized]).toBe("+09:00");
    const comment = ifds.exif.get(TAG.userComment);
    expect(comment?.type).toBe("undefined");
    expect(
      Buffer.from(comment?.value as Uint8Array).toString("latin1"),
    ).toBe("ASCII\0\0\0Scanned with: GCMC Scanner");
    expect(
      Buffer.from(encodeTiff(ifds)!).includes(
        Buffer.from("ASCII\0\0\0Scanned with: GCMC Scanner"),
      ),
    ).toBe(true);
    // A maker's name that is also the model's start is said once.
    expect(digitizerText({ manufacturer: "Nikon", model: "Nikon LS-5000" })).toBe(
      "Nikon LS-5000",
    );
    expect(digitizerText({ manufacturer: "Epson", model: null })).toBe("Epson");
    // Hidden: neither.
    const none = publicExif({ digitizer: null, digitized_at: null });
    expect(encodeTiff(none)).toBeNull();
  });

  it("writes a non-ASCII UserComment as UTF-16", () => {
    const v = userComment("ス");
    expect(v.type).toBe("undefined");
    expect([...(v.value as Uint8Array)]).toEqual([
      ...new TextEncoder().encode("UNICODE\0"),
      0x30,
      0xb9,
    ]);
  });

  it("follows each level of the projection", async () => {
    // Camera at "manufacturer": Make only, no lens even if exif has one.
    const maker = await readTiff(
      encodeTiff(
        publicExif({
          camera: { slug: null, manufacturer: "Sony", model: null },
          exif: { lens: "FE 50mm" },
        }),
      )!,
    );
    expect(maker.ifd0[TAG.make]).toBe("Sony");
    expect(maker.ifd0[TAG.model]).toBeUndefined();
    expect(maker.exif).toBeUndefined();
    // Camera hidden: no lens either.
    const hidden = encodeTiff(
      publicExif({ camera: null, exif: { lens: "GR LENS 18.3mm" } }),
    );
    expect(hidden).toBeNull();
    // Location at "city": two decimals, as the API rounded it.
    const city = publicExif({
      location: { latitude: 35.66, longitude: 139.74, precision: "city" },
    });
    expect(city.gps.get(TAG.gpsLatitude)).toEqual({
      type: "rational",
      value: [
        [3566, 100],
        [0, 1],
        [0, 1],
      ],
    });
    // Unknown precision levels are not written.
    expect(
      publicExif({
        location: { latitude: 1, longitude: 2, precision: "planet" },
        timestamp: "2026-11-18T01:02:03+09:00",
        timestamp_precision: "hidden",
      }),
    ).toEqual({ ifd0: new Map(), exif: new Map(), gps: new Map() });
  });
});

describe("exifDateTime", () => {
  const ts = "2026-11-18T01:02:03.456+09:00";
  it("blanks what the precision hides", () => {
    expect(exifDateTime(ts, "second")).toEqual({
      dateTime: "2026:11:18 01:02:03",
      offset: "+09:00",
    });
    expect(exifDateTime(ts, "minute")?.dateTime).toBe("2026:11:18 01:02:  ");
    expect(exifDateTime(ts, "date")?.dateTime).toBe("2026:11:18   :  :  ");
    expect(exifDateTime(ts, "month")?.dateTime).toBe("2026:11:     :  :  ");
    expect(exifDateTime(ts, "year")?.dateTime).toBe("2026:  :     :  :  ");
    for (const v of Object.values(["second", "minute", "date", "month", "year"])) {
      expect(exifDateTime(ts, v)?.dateTime).toHaveLength(19);
    }
    expect(exifDateTime("2026-11-18T01:02:03Z", "second")?.offset).toBe("+00:00");
    expect(exifDateTime(ts, null)).toBeNull();
    expect(exifDateTime("garbage", "second")).toBeNull();
    // An old timestamp without an offset: the time, no OffsetTimeOriginal.
    expect(exifDateTime("2023-12-11T01:21:32", "second")).toEqual({
      dateTime: "2023:12:11 01:21:32",
      offset: null,
    });
  });
});

describe("exposureRational", () => {
  it("reads fractions and decimals", () => {
    expect(exposureRational("1/250")).toEqual([1, 250]);
    expect(exposureRational("2")).toEqual([20000, 10000]);
    expect(exposureRational("0.5")).toEqual([5000, 10000]);
    expect(exposureRational("1/0")).toBeNull();
    expect(exposureRational("-1")).toBeNull();
    expect(exposureRational("fast")).toBeNull();
  });
});

/** RIFF chunks of a WebP, as [fourcc, data]. */
const riff = (b: Uint8Array): [string, Uint8Array][] => {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(String.fromCharCode(...b.subarray(0, 4))).toBe("RIFF");
  expect(d.getUint32(4, true)).toBe(b.length - 8);
  const out: [string, Uint8Array][] = [];
  for (let p = 12; p < b.length; ) {
    const size = d.getUint32(p + 4, true);
    out.push([
      String.fromCharCode(...b.subarray(p, p + 4)),
      b.subarray(p + 8, p + 8 + size),
    ]);
    p += 8 + size + (size & 1);
  }
  return out;
};

describe("embedExif", () => {
  const ifds: ExifIfds = publicExif(FULL);
  const tiff = encodeTiff(ifds)!;

  it("puts an APP1 after JFIF in a JPEG, keeping the rest byte for byte", async () => {
    const jpeg = fixture("plain.jpg");
    const out = embedJpeg(jpeg, tiff)!;
    // SOI + APP0 as before, then the new APP1, then the original from there.
    const app0End = 4 + ((jpeg[4] << 8) | jpeg[5]);
    expect(out.subarray(0, app0End)).toEqual(jpeg.subarray(0, app0End));
    expect([out[app0End], out[app0End + 1]]).toEqual([0xff, 0xe1]);
    expect(out.subarray(out.length - (jpeg.length - app0End))).toEqual(
      jpeg.subarray(app0End),
    );
    const got = (await exifr.parse(Buffer.from(out), {
      translateKeys: false,
      reviveValues: false,
      mergeOutput: false,
      gps: true,
    })) as Record<string, Record<number, unknown>>;
    expect(got.ifd0[TAG.make]).toBe("FUJIFILM");
    expect(got.exif[TAG.dateTimeOriginal]).toBe("2026:11:18 01:02:03");
    expect(got.gps[TAG.gpsLatitudeRef]).toBe("N");
  });

  it.each([
    ["lossy.webp", "VP8 ", 6, 4, 0x08],
    ["lossless-alpha.webp", "VP8L", 5, 3, 0x18],
  ])(
    "turns a simple WebP (%s) into VP8X + image + EXIF",
    async (name, fourcc, w, h, flags) => {
      const webp = fixture(name);
      const before = riff(webp);
      expect(before.map(([f]) => f)).toEqual([fourcc]);
      const out = embedWebp(webp, tiff)!;
      const chunks = riff(out);
      expect(chunks.map(([f]) => f)).toEqual(["VP8X", fourcc, "EXIF"]);
      const [, x] = chunks[0];
      expect(x[0]).toBe(flags);
      expect(x[4] | (x[5] << 8) | (x[6] << 16)).toBe(w - 1);
      expect(x[7] | (x[8] << 8) | (x[9] << 16)).toBe(h - 1);
      // The compressed image is untouched.
      expect(chunks[1][1]).toEqual(before[0][1]);
      expect(chunks[2][1]).toEqual(tiff);
      expect((await readTiff(chunks[2][1])).ifd0[TAG.make]).toBe("FUJIFILM");
    },
  );

  it("sets the EXIF flag on an extended WebP and appends the chunk", () => {
    const webp = fixture("lossy-alpha.webp");
    const before = riff(webp);
    expect(before.map(([f]) => f)).toEqual(["VP8X", "ALPH", "VP8 "]);
    const chunks = riff(embedWebp(webp, tiff)!);
    expect(chunks.map(([f]) => f)).toEqual(["VP8X", "ALPH", "VP8 ", "EXIF"]);
    expect(chunks[0][1][0]).toBe(before[0][1][0] | 0x08);
    expect(chunks[1][1]).toEqual(before[1][1]);
    expect(chunks[2][1]).toEqual(before[2][1]);
  });

  it("leaves other formats and broken files alone", () => {
    const avif = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70]);
    expect(embedExif(avif, "image/avif", tiff)).toEqual({
      bytes: avif,
      embedded: false,
    });
    const truncated = fixture("lossy.webp").subarray(0, 20);
    expect(embedExif(truncated, "image/webp", tiff).embedded).toBe(false);
    expect(embedExif(fixture("plain.jpg"), "image/jpeg; q=1", tiff).embedded).toBe(true);
  });
});
