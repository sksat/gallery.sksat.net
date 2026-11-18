/**
 * A minimal TIFF/EXIF writer (tested with Vitest, read back by an
 * independent parser): IFD0 with the EXIF and GPS sub-IFDs, big-endian,
 * no thumbnail. Only the types the image Worker writes: BYTE, ASCII,
 * SHORT, LONG, RATIONAL, UNDEFINED.
 *
 * ASCII values are written as UTF-8 (a world name may be Japanese). That
 * is outside EXIF's 7-bit ASCII, but it is what most writers do and what
 * readers (exiftool, browsers, OS viewers) expect.
 */

export type ExifValue =
  | { type: "ascii"; value: string }
  | { type: "short"; value: number[] }
  | { type: "long"; value: number[] }
  | { type: "rational"; value: [number, number][] }
  | { type: "byte"; value: Uint8Array }
  | { type: "undefined"; value: Uint8Array };

/** Tag → value, per IFD. */
export type ExifIfds = {
  ifd0: Map<number, ExifValue>;
  exif: Map<number, ExifValue>;
  gps: Map<number, ExifValue>;
};

export const TAG = {
  imageDescription: 0x010e,
  make: 0x010f,
  model: 0x0110,
  artist: 0x013b,
  copyright: 0x8298,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  exifVersion: 0x9000,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  focalLength: 0x920a,
  lensModel: 0xa434,
  gpsVersionId: 0x0000,
  gpsLatitudeRef: 0x0001,
  gpsLatitude: 0x0002,
  gpsLongitudeRef: 0x0003,
  gpsLongitude: 0x0004,
} as const;

const TYPE_CODE = {
  byte: 1,
  ascii: 2,
  short: 3,
  long: 4,
  rational: 5,
  undefined: 7,
};

const encodeValue = (
  v: ExifValue,
): { type: number; count: number; bytes: Uint8Array } => {
  switch (v.type) {
    case "ascii": {
      const s = new TextEncoder().encode(v.value);
      const bytes = new Uint8Array(s.length + 1);
      bytes.set(s);
      return { type: 2, count: bytes.length, bytes };
    }
    case "byte":
    case "undefined":
      return {
        type: TYPE_CODE[v.type],
        count: v.value.length,
        bytes: v.value,
      };
    case "short": {
      const bytes = new Uint8Array(v.value.length * 2);
      const d = new DataView(bytes.buffer);
      v.value.forEach((n, i) => d.setUint16(i * 2, n));
      return { type: 3, count: v.value.length, bytes };
    }
    case "long": {
      const bytes = new Uint8Array(v.value.length * 4);
      const d = new DataView(bytes.buffer);
      v.value.forEach((n, i) => d.setUint32(i * 4, n));
      return { type: 4, count: v.value.length, bytes };
    }
    case "rational": {
      const bytes = new Uint8Array(v.value.length * 8);
      const d = new DataView(bytes.buffer);
      v.value.forEach(([a, b], i) => {
        d.setUint32(i * 8, a);
        d.setUint32(i * 8 + 4, b);
      });
      return { type: TYPE_CODE.rational, count: v.value.length, bytes };
    }
  }
};

const ifdSize = (n: number) => 2 + n * 12 + 4;

/**
 * The TIFF block (what follows "Exif\0\0" in a JPEG APP1, and a WebP's
 * EXIF chunk). Empty sub-IFDs are left out; null when there is nothing.
 */
export const encodeTiff = (ifds: ExifIfds): Uint8Array | null => {
  const exif = [...ifds.exif];
  const gps = [...ifds.gps];
  const ifd0 = [...ifds.ifd0].filter(
    ([t]) => t !== TAG.exifIfd && t !== TAG.gpsIfd,
  );
  if (ifd0.length + exif.length + gps.length === 0) return null;

  type Entry = [number, ExifValue | "pointer"];
  const blocks: { name: "ifd0" | "exif" | "gps"; entries: Entry[] }[] = [
    {
      name: "ifd0",
      entries: [
        ...ifd0,
        ...(exif.length ? [[TAG.exifIfd, "pointer"] as Entry] : []),
        ...(gps.length ? [[TAG.gpsIfd, "pointer"] as Entry] : []),
      ],
    },
    ...(exif.length
      ? [{ name: "exif" as const, entries: exif as Entry[] }]
      : []),
    ...(gps.length ? [{ name: "gps" as const, entries: gps as Entry[] }] : []),
  ];
  for (const b of blocks) b.entries.sort((x, y) => x[0] - y[0]);

  // Layout: header, then each IFD followed by its out-of-line values.
  const offsets: Record<string, number> = {};
  let at = 8;
  const encoded = blocks.map((b) => {
    offsets[b.name] = at;
    const values = b.entries.map(([, v]) =>
      v === "pointer" ? null : encodeValue(v),
    );
    at += ifdSize(b.entries.length);
    const dataAt: number[] = values.map((e) => {
      if (!e || e.bytes.length <= 4) return -1;
      const here = at;
      at += e.bytes.length + (e.bytes.length & 1);
      return here;
    });
    return { ...b, values, dataAt };
  });

  const out = new Uint8Array(at);
  const d = new DataView(out.buffer);
  d.setUint16(0, 0x4d4d);
  d.setUint16(2, 42);
  d.setUint32(4, 8);
  for (const b of encoded) {
    const base = offsets[b.name];
    d.setUint16(base, b.entries.length);
    b.entries.forEach(([tag, v], i) => {
      const e = base + 2 + i * 12;
      d.setUint16(e, tag);
      const value = b.values[i];
      if (v === "pointer" || !value) {
        d.setUint16(e + 2, TYPE_CODE.long);
        d.setUint32(e + 4, 1);
        d.setUint32(e + 8, offsets[tag === TAG.exifIfd ? "exif" : "gps"]);
        return;
      }
      d.setUint16(e + 2, value.type);
      // Values of up to 4 bytes sit in the entry, left-justified.
      d.setUint32(e + 4, value.count);
      if (b.dataAt[i] < 0) out.set(value.bytes, e + 8);
      else {
        d.setUint32(e + 8, b.dataAt[i]);
        out.set(value.bytes, b.dataAt[i]);
      }
    });
    // Next IFD: none (no thumbnail).
    d.setUint32(base + 2 + b.entries.length * 12, 0);
  }
  return out;
};
