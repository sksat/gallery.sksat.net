// Everything a photo file says about itself, as a JSON-able tree, for the
// edit page's ファイルのメタデータ (read on demand, never stored). Apart
// from photo-meta.ts, which reads the few fields the admin keeps: this one
// walks the whole container and shows what it finds, decoded where it is
// cheap and as a size and a hex head where it is not.
//
// JPEG: every segment before the image data (APPn: EXIF, XMP and extended
// XMP, ICC, IPTC / Photoshop, JFIF, Adobe, others; COM; the frame size).
// PNG: every chunk but the image data (text chunks inflated, eXIf through
// the same EXIF reader, iCCP, …), also after IDAT. WebP: its RIFF chunks.
//
// The file is read through ranged reads of at most 256 KiB (AdminImage.bytes)
// and at most MAX_READS of them per call, well under the Pages Functions
// limit of 50 subrequests; what could not be reached is reported.

/** A JSON value. */
export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };

/** Where a section comes from; the page groups by it. */
export type Source =
  | "File"
  | "EXIF"
  | "XMP"
  | "ICC"
  | "IPTC"
  | "Photoshop"
  | "JFIF"
  | "Adobe"
  | "Comment"
  | "JPEG"
  | "PNG"
  | "WebP"
  | "Other";

export type RawSection = {
  source: Source;
  /** What it is within the source (a segment, a chunk, an IFD). */
  name: string;
  /** Byte offset of its segment or chunk in the file. */
  offset: number;
  data: Json;
};

export type RawMeta = {
  format: "jpeg" | "png" | "webp" | "unknown";
  /** The file's size in bytes. */
  size: number;
  sections: RawSection[];
  /** Ranged reads made. */
  reads: number;
  /** Set when part of the file could not be walked (and why). */
  truncated: string | null;
};

/** One ranged read (AdminImage.bytes), bound to a file. */
export type RangeRead = (
  range: { offset: number; length: number } | { suffix: number },
) => Promise<{ bytes: Uint8Array; size: number } | null>;

/** The most AdminImage.bytes returns in one call. */
export const MAX_READ_BYTES = 256 * 1024;

/** Ranged reads per call (each one is a subrequest). */
export const MAX_READS = 12;

/** The largest segment or chunk read whole; bigger ones are shown by head. */
export const MAX_ITEM_BYTES = 1024 * 1024;

/** The most a compressed text or profile is inflated to. */
export const MAX_INFLATE_BYTES = 1024 * 1024;

/** Bytes shown of a blob. */
const HEAD_BYTES = 32;

class OutOfReads extends Error {}

/** Sections in one answer (a crafted file of empty segments stops here). */
export const MAX_SECTIONS = 500;
const TOO_MANY = `more than ${MAX_SECTIONS} segments`;

/** Why a walk stopped at `p`: what was found before it is kept. */
const stopped = (e: unknown, f: RangedFile, p: number) =>
  e instanceof OutOfReads
    ? `read limit (${f.maxReads} reads) reached at byte ${p}`
    : `stopped at byte ${p}: ${e instanceof Error ? e.message : String(e)}`;

/** The file seen through ranged reads, with what was read kept. */
export class RangedFile {
  private windows: { offset: number; bytes: Uint8Array }[] = [];
  reads = 0;
  size = 0;

  constructor(
    private readonly read: RangeRead,
    readonly maxReads = MAX_READS,
  ) {}

  /** The first window; false when there is no such file. */
  async open(): Promise<boolean> {
    const got = await this.read({ offset: 0, length: MAX_READ_BYTES });
    this.reads++;
    if (!got) return false;
    this.size = got.size;
    this.windows.push({ offset: 0, bytes: got.bytes });
    return true;
  }

  get readsLeft() {
    return this.maxReads - this.reads;
  }

  private find(pos: number) {
    return this.windows.find(
      (w) => w.offset <= pos && pos < w.offset + w.bytes.length,
    );
  }

  /** Whether [offset, offset + length) is already read. */
  covered(offset: number, length: number): boolean {
    let p = offset;
    const end = Math.min(offset + length, this.size);
    while (p < end) {
      const w = this.find(p);
      if (!w) return false;
      p = w.offset + w.bytes.length;
    }
    return true;
  }

  /** The last bytes of the file (one read). */
  async readTail(): Promise<number> {
    if (this.readsLeft <= 0) throw new OutOfReads();
    const n = Math.min(MAX_READ_BYTES, this.size);
    const got = await this.read({ suffix: n });
    this.reads++;
    if (!got) throw new Error("the file went away");
    const offset = this.size - got.bytes.length;
    this.windows.push({ offset, bytes: got.bytes });
    return offset;
  }

  /** [offset, offset + length), clipped to the file; reads what is missing. */
  async get(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(offset + length, this.size);
    if (end <= offset) return new Uint8Array(0);
    const out = new Uint8Array(end - offset);
    let p = offset;
    while (p < end) {
      let w = this.find(p);
      if (!w) {
        if (this.readsLeft <= 0) throw new OutOfReads();
        const got = await this.read({
          offset: p,
          length: Math.min(MAX_READ_BYTES, this.size - p),
        });
        this.reads++;
        if (!got || got.bytes.length === 0) {
          throw new Error("the file is shorter than it said");
        }
        w = { offset: p, bytes: got.bytes };
        this.windows.push(w);
      }
      const from = p - w.offset;
      const take = Math.min(w.bytes.length - from, end - p);
      out.set(w.bytes.subarray(from, from + take), p - offset);
      p += take;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Small helpers

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

/** A blob nobody decodes: its size and first bytes. */
export const blob = (b: Uint8Array, size = b.length, type?: string): Json => {
  const o: { [k: string]: Json } = {};
  if (type) o.type = type;
  o.size = size;
  o.head = hex(b.subarray(0, HEAD_BYTES));
  return o;
};

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

/** UTF-8 when it is valid, else Latin-1. */
const text = (b: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return latin1(b);
  }
};

const ascii = (b: Uint8Array, at: number, n: number) =>
  latin1(b.subarray(at, at + n));

const startsWith = (b: Uint8Array, s: string, at = 0) => {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (b[at + i] !== s.charCodeAt(i)) return false;
  }
  return true;
};

const indexOf0 = (b: Uint8Array, from = 0) => {
  for (let i = from; i < b.length; i++) if (b[i] === 0) return i;
  return -1;
};

const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const le32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

const printable = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** Deeper JSON stays text (the page and JSON.stringify recurse). */
const MAX_JSON_DEPTH = 32;

/** Whether `[` / `{` nest deeper than `max` (strings aside). */
const tooDeep = (t: string, max: number) => {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") {
      if (++depth > max) return true;
    } else if (c === "]" || c === "}") depth--;
  }
  return false;
};

/** Text that is a JSON object or array, parsed; anything else as it is. */
export const maybeJson = (s: string): Json => {
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return s;
  if (tooDeep(t, MAX_JSON_DEPTH)) return s;
  try {
    return JSON.parse(t) as Json;
  } catch {
    return s;
  }
};

/** zlib data inflated, or null when it is not zlib or too big. */
export const inflate = async (
  z: Uint8Array,
  max = MAX_INFLATE_BYTES,
): Promise<Uint8Array | null> => {
  const reader = new Blob([new Uint8Array(z)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) return null;
      parts.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (PNG's). */
export const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++)
    c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ---------------------------------------------------------------------------
// EXIF (TIFF structure)

const IFD0_TAGS: Record<number, string> = {
  0x000b: "ProcessingSoftware",
  0x00fe: "NewSubfileType",
  0x0100: "ImageWidth",
  0x0101: "ImageLength",
  0x0102: "BitsPerSample",
  0x0103: "Compression",
  0x0106: "PhotometricInterpretation",
  0x010d: "DocumentName",
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0111: "StripOffsets",
  0x0112: "Orientation",
  0x0115: "SamplesPerPixel",
  0x0116: "RowsPerStrip",
  0x0117: "StripByteCounts",
  0x011a: "XResolution",
  0x011b: "YResolution",
  0x011c: "PlanarConfiguration",
  0x0128: "ResolutionUnit",
  0x012d: "TransferFunction",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x013c: "HostComputer",
  0x013e: "WhitePoint",
  0x013f: "PrimaryChromaticities",
  0x014a: "SubIFDs",
  0x0201: "JPEGInterchangeFormat",
  0x0202: "JPEGInterchangeFormatLength",
  0x0211: "YCbCrCoefficients",
  0x0212: "YCbCrSubSampling",
  0x0213: "YCbCrPositioning",
  0x0214: "ReferenceBlackWhite",
  0x02bc: "XMLPacket",
  0x4746: "Rating",
  0x4749: "RatingPercent",
  0x8298: "Copyright",
  0x83bb: "IPTC-NAA",
  0x8649: "PhotoshopSettings",
  0x8769: "ExifIFDPointer",
  0x8773: "InterColorProfile",
  0x8825: "GPSInfoIFDPointer",
  0x9c9b: "XPTitle",
  0x9c9c: "XPComment",
  0x9c9d: "XPAuthor",
  0x9c9e: "XPKeywords",
  0x9c9f: "XPSubject",
  0xa005: "InteroperabilityIFDPointer",
  0xc4a5: "PrintImageMatching",
  0xc612: "DNGVersion",
  0xc614: "UniqueCameraModel",
};

const EXIF_TAGS: Record<number, string> = {
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8822: "ExposureProgram",
  0x8824: "SpectralSensitivity",
  0x8827: "ISOSpeedRatings",
  0x8828: "OECF",
  0x8830: "SensitivityType",
  0x8831: "StandardOutputSensitivity",
  0x8832: "RecommendedExposureIndex",
  0x8833: "ISOSpeed",
  0x9000: "ExifVersion",
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9010: "OffsetTime",
  0x9011: "OffsetTimeOriginal",
  0x9012: "OffsetTimeDigitized",
  0x9101: "ComponentsConfiguration",
  0x9102: "CompressedBitsPerPixel",
  0x9201: "ShutterSpeedValue",
  0x9202: "ApertureValue",
  0x9203: "BrightnessValue",
  0x9204: "ExposureBiasValue",
  0x9205: "MaxApertureValue",
  0x9206: "SubjectDistance",
  0x9207: "MeteringMode",
  0x9208: "LightSource",
  0x9209: "Flash",
  0x920a: "FocalLength",
  0x9214: "SubjectArea",
  0x927c: "MakerNote",
  0x9286: "UserComment",
  0x9290: "SubSecTime",
  0x9291: "SubSecTimeOriginal",
  0x9292: "SubSecTimeDigitized",
  0xa000: "FlashpixVersion",
  0xa001: "ColorSpace",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa004: "RelatedSoundFile",
  0xa005: "InteroperabilityIFDPointer",
  0xa20b: "FlashEnergy",
  0xa20e: "FocalPlaneXResolution",
  0xa20f: "FocalPlaneYResolution",
  0xa210: "FocalPlaneResolutionUnit",
  0xa214: "SubjectLocation",
  0xa215: "ExposureIndex",
  0xa217: "SensingMethod",
  0xa300: "FileSource",
  0xa301: "SceneType",
  0xa302: "CFAPattern",
  0xa401: "CustomRendered",
  0xa402: "ExposureMode",
  0xa403: "WhiteBalance",
  0xa404: "DigitalZoomRatio",
  0xa405: "FocalLengthIn35mmFilm",
  0xa406: "SceneCaptureType",
  0xa407: "GainControl",
  0xa408: "Contrast",
  0xa409: "Saturation",
  0xa40a: "Sharpness",
  0xa40c: "SubjectDistanceRange",
  0xa420: "ImageUniqueID",
  0xa430: "CameraOwnerName",
  0xa431: "BodySerialNumber",
  0xa432: "LensSpecification",
  0xa433: "LensMake",
  0xa434: "LensModel",
  0xa435: "LensSerialNumber",
  0xa460: "CompositeImage",
  0xa500: "Gamma",
};

const GPS_TAGS: Record<number, string> = {
  0x00: "GPSVersionID",
  0x01: "GPSLatitudeRef",
  0x02: "GPSLatitude",
  0x03: "GPSLongitudeRef",
  0x04: "GPSLongitude",
  0x05: "GPSAltitudeRef",
  0x06: "GPSAltitude",
  0x07: "GPSTimeStamp",
  0x08: "GPSSatellites",
  0x09: "GPSStatus",
  0x0a: "GPSMeasureMode",
  0x0b: "GPSDOP",
  0x0c: "GPSSpeedRef",
  0x0d: "GPSSpeed",
  0x0e: "GPSTrackRef",
  0x0f: "GPSTrack",
  0x10: "GPSImgDirectionRef",
  0x11: "GPSImgDirection",
  0x12: "GPSMapDatum",
  0x13: "GPSDestLatitudeRef",
  0x14: "GPSDestLatitude",
  0x15: "GPSDestLongitudeRef",
  0x16: "GPSDestLongitude",
  0x17: "GPSDestBearingRef",
  0x18: "GPSDestBearing",
  0x19: "GPSDestDistanceRef",
  0x1a: "GPSDestDistance",
  0x1b: "GPSProcessingMethod",
  0x1c: "GPSAreaInformation",
  0x1d: "GPSDateStamp",
  0x1e: "GPSDifferential",
  0x1f: "GPSHPositioningError",
};

const INTEROP_TAGS: Record<number, string> = {
  0x0001: "InteroperabilityIndex",
  0x0002: "InteroperabilityVersion",
  0x1000: "RelatedImageFileFormat",
  0x1001: "RelatedImageWidth",
  0x1002: "RelatedImageLength",
};

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};

const MAX_IFD_ENTRIES = 1024;
/** IFD0, IFD1, … followed. */
const MAX_IFD_CHAIN = 8;
/** IFDs read in all. */
const MAX_IFDS = 16;
/** Numbers shown of a long array (the rest as a count). */
const MAX_LIST = 64;
/** BYTE / UNDEFINED values longer than this are shown by head. */
const MAX_SMALL_BLOB = 64;
/** The longest ASCII value kept. */
const MAX_ASCII = 64 * 1024;

const POINTERS: Record<number, string> = {
  0x8769: "Exif",
  0x8825: "GPS",
  0xa005: "Interop",
};

/** UserComment / GPSProcessingMethod: 8 bytes of charset, then the text. */
const commentText = (b: Uint8Array, little: boolean): Json => {
  if (b.length < 8) return blob(b);
  const code = ascii(b, 0, 8).replace(/\0+$/, "");
  const body = b.subarray(8);
  if (code === "ASCII" || code === "") {
    return latin1(body).replace(/\0+$/, "").trimEnd();
  }
  if (code === "UNICODE") {
    return new TextDecoder(little ? "utf-16le" : "utf-16be")
      .decode(body)
      .replace(/\0+$/, "");
  }
  if (code === "JIS") return blob(b, b.length, "JIS");
  return blob(b);
};

/** The Windows XP* tags: UTF-16LE in BYTEs. */
const xpText = (b: Uint8Array) =>
  new TextDecoder("utf-16le").decode(b).replace(/\0+$/, "");

/**
 * Every IFD of a TIFF structure (EXIF): IFD0 and the next ones (IFD1, …),
 * and the Exif, GPS and Interop IFDs they point to, each tag as
 * "Name (0x0000)" with its value decoded by type.
 */
export const readTiff = (b: Uint8Array): Json => {
  if (b.length < 8) return { error: "too short", ...(blob(b) as object) };
  const order = ascii(b, 0, 2);
  const little = order === "II";
  if (!little && order !== "MM") {
    return { error: "not TIFF", ...(blob(b) as object) };
  }
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (u16(2) !== 42) return { error: "not TIFF", ...(blob(b) as object) };

  const out: { [k: string]: Json } = {
    byteOrder: little ? "little-endian (II)" : "big-endian (MM)",
  };
  const seen = new Set<number>();
  let ifds = 0;
  const budget = () => ++ifds <= MAX_IFDS;

  const value = (
    tag: number,
    type: number,
    count: number,
    at: number,
  ): Json => {
    const size = TYPE_SIZE[type];
    if (!size) return { type, count, error: "unknown type" };
    const bytes = size * count;
    const data = bytes <= 4 ? at : u32(at);
    if (data + bytes > b.length) {
      return { type, count, error: "past the end of the segment" };
    }
    const raw = b.subarray(data, data + bytes);
    if (tag === 0x927c) return blob(raw, bytes, "MakerNote");
    if (tag === 0x9286 || tag === 0x001b || tag === 0x001c) {
      return commentText(raw, little);
    }
    if (tag >= 0x9c9b && tag <= 0x9c9f && (type === 1 || type === 7)) {
      return xpText(raw);
    }
    if (type === 2) {
      const s = latin1(raw.subarray(0, MAX_ASCII)).replace(/\0+$/, "");
      // Valid UTF-8 (often, despite the spec) shows as such.
      return text(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    }
    if (type === 1 || type === 7 || type === 6) {
      if (type === 7 && bytes <= 16) {
        const s = latin1(raw).replace(/\0+$/, "");
        if (s && printable(s)) return s;
      }
      if (bytes > MAX_SMALL_BLOB) return blob(raw, bytes);
      if (type === 7) return hex(raw);
    }
    const list: Json[] = [];
    const n = Math.min(count, MAX_LIST);
    for (let i = 0; i < n; i++) {
      const o = data + i * size;
      switch (type) {
        case 1:
        case 7:
          list.push(view.getUint8(o));
          break;
        case 6:
          list.push(view.getInt8(o));
          break;
        case 3:
          list.push(u16(o));
          break;
        case 8:
          list.push(view.getInt16(o, little));
          break;
        case 4:
        case 13:
          list.push(u32(o));
          break;
        case 9:
          list.push(view.getInt32(o, little));
          break;
        case 5:
          list.push(`${u32(o)}/${u32(o + 4)}`);
          break;
        case 10:
          list.push(
            `${view.getInt32(o, little)}/${view.getInt32(o + 4, little)}`,
          );
          break;
        case 11:
          list.push(view.getFloat32(o, little));
          break;
        case 12:
          list.push(view.getFloat64(o, little));
          break;
      }
    }
    if (count > n) list.push(`… ${count - n} more`);
    return count === 1 ? list[0] : list;
  };

  const readIfd = (
    at: number,
    names: Record<number, string>,
  ): {
    tags: { [k: string]: Json };
    next: number;
    pointers: [string, number][];
  } | null => {
    if (at < 8 || at + 2 > b.length || seen.has(at)) return null;
    seen.add(at);
    const n = u16(at);
    const tags: { [k: string]: Json } = {};
    const pointers: [string, number][] = [];
    if (n > MAX_IFD_ENTRIES || at + 2 + n * 12 > b.length) {
      return { tags: { error: `bad IFD (${n} entries)` }, next: 0, pointers };
    }
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const name = names[tag] ?? IFD0_TAGS[tag] ?? EXIF_TAGS[tag];
      const key = `${name ?? "Tag"} (0x${tag.toString(16).padStart(4, "0")})`;
      tags[key] = value(tag, type, count, e + 8);
      const ptr = POINTERS[tag];
      if (ptr && count === 1 && (type === 4 || type === 13)) {
        pointers.push([ptr, u32(e + 8)]);
      }
    }
    const nextAt = at + 2 + n * 12;
    const next = nextAt + 4 <= b.length ? u32(nextAt) : 0;
    return { tags, next, pointers };
  };

  const NAMES: Record<string, Record<number, string>> = {
    Exif: EXIF_TAGS,
    GPS: GPS_TAGS,
    Interop: INTEROP_TAGS,
  };
  // The sub-IFDs (Exif, GPS, Interop), breadth first; each name once, so
  // a crafted chain of pointers ends.
  const follow = (pointers: [string, number][]) => {
    const queue = [...pointers];
    while (queue.length) {
      const [name, at] = queue.shift()!;
      if (name in out || !budget()) continue;
      const ifd = readIfd(at, NAMES[name]);
      if (!ifd) continue;
      out[name] = ifd.tags;
      queue.push(...ifd.pointers);
    }
  };

  let at = u32(4);
  for (let i = 0; at && i < MAX_IFD_CHAIN && budget(); i++) {
    const ifd = readIfd(at, IFD0_TAGS);
    if (!ifd) break;
    out[`IFD${i}`] = ifd.tags;
    follow(ifd.pointers);
    at = ifd.next;
  }
  if (ifds > MAX_IFDS) out.error = "too many IFDs";
  return out;
};

// ---------------------------------------------------------------------------
// XMP

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const cp = k.startsWith("#x")
      ? parseInt(k.slice(2), 16)
      : parseInt(k.slice(1), 10);
    try {
      return String.fromCodePoint(cp);
    } catch {
      return m;
    }
  });

/** Element and attribute names that are RDF's frame, not properties. */
const FRAME =
  /^(x:xmpmeta|x:xapmeta|rdf:RDF|rdf:Description|rdf:Seq|rdf:Bag|rdf:Alt|rdf:li)$/;
const SKIP_ATTR =
  /^(xmlns(:.*)?|rdf:about|rdf:parseType|xml:lang|rdf:resource|x:xmptk)$/;

/**
 * An XMP packet's properties as "prefix:Name" (nested ones joined with
 * "/") → text, lists (rdf:Seq / Bag / Alt) as arrays. Text that is JSON
 * is parsed.
 */
export const flattenXmp = (xml: string): { [k: string]: Json } => {
  const out: { [k: string]: Json } = {};
  const stack: string[] = [];
  const put = (key: string, v: string, inList: boolean) => {
    if (!key) return;
    const val = maybeJson(decodeEntities(v));
    const cur = Object.hasOwn(out, key) ? out[key] : undefined;
    if (Array.isArray(cur)) {
      cur.push(val);
      return;
    }
    const next: Json = cur === undefined ? (inList ? [val] : val) : [cur, val];
    // defineProperty: a key "__proto__" stays a key.
    Object.defineProperty(out, key, {
      value: next,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };
  const path = () => stack.filter((n) => !FRAME.test(n)).join("/");
  // A hand-written walk with indexOf (no backtracking regex over the
  // whole packet): an unterminated construct ends it.
  let i = 0;
  let lastOpen: string | null = null;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const txt = xml.slice(i, lt < 0 ? xml.length : lt);
    if (lastOpen !== null && txt.trim()) {
      put(path(), txt, stack[stack.length - 1] === "rdf:li");
    }
    if (lt < 0) break;
    const end = (s: string) => {
      const k = xml.indexOf(s, lt);
      return k < 0 ? -1 : k + s.length;
    };
    if (xml.startsWith("<?", lt)) {
      i = end("?>");
    } else if (xml.startsWith("<!--", lt)) {
      i = end("-->");
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const k = end("]]>");
      if (k >= 0 && lastOpen !== null) {
        put(path(), xml.slice(lt + 9, k - 3), stack.at(-1) === "rdf:li");
      }
      i = k;
    } else if (xml.startsWith("<!", lt)) {
      i = end(">");
    } else {
      // The tag's ">", outside quoted attribute values.
      let k = -1;
      let quote = "";
      for (let j = lt + 1; j < xml.length; j++) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") {
          k = j + 1;
          break;
        }
      }
      if (k < 0) break;
      const tag = xml.slice(lt + 1, k - 1);
      i = k;
      const close = tag.startsWith("/");
      const name = /^\/?([^\s/>]+)/.exec(tag)?.[1];
      if (!name) continue;
      if (close) {
        // Pop to the matching element (tolerating a broken packet).
        const at = stack.lastIndexOf(name);
        if (at >= 0) stack.length = at;
        lastOpen = null;
        continue;
      }
      if (stack.length >= MAX_XMP_DEPTH) break;
      stack.push(name);
      lastOpen = name;
      const prefix = path();
      for (const a of tag.matchAll(ATTR_RE)) {
        if (SKIP_ATTR.test(a[1])) continue;
        put(prefix ? `${prefix}/${a[1]}` : a[1], a[2] ?? a[3] ?? "", false);
      }
      if (tag.endsWith("/")) {
        stack.pop();
        lastOpen = null;
      }
    }
    if (i < 0) break;
  }
  return out;
};

const ATTR_RE = /\s([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const MAX_XMP_DEPTH = 64;
/** XMP longer than this is shown as text only, its first part flattened. */
const MAX_XMP_FLATTEN = 256 * 1024;
/** XMP text kept in the answer. */
const MAX_XMP_TEXT = 256 * 1024;

const xmpData = (xml: string): Json => {
  const out: { [k: string]: Json } = {
    properties: flattenXmp(xml.slice(0, MAX_XMP_FLATTEN)),
  };
  if (xml.length > MAX_XMP_TEXT) {
    out.xml = xml.slice(0, MAX_XMP_TEXT);
    out.length = xml.length;
  } else out.xml = xml;
  return out;
};

// ---------------------------------------------------------------------------
// ICC profile

const sig = (b: Uint8Array, at: number) =>
  ascii(b, at, 4).replace(/[\0 ]+$/, "");

/** A 'desc' / 'mluc' / 'text' tag's text. */
const iccText = (b: Uint8Array, at: number, size: number): Json => {
  if (at + size > b.length || size < 8) return null;
  const type = sig(b, at);
  if (type === "desc") {
    const n = be32(b, at + 8);
    return latin1(b.subarray(at + 12, at + 12 + n)).replace(/\0+$/, "");
  }
  if (type === "text") {
    return latin1(b.subarray(at + 8, at + size)).replace(/\0+$/, "");
  }
  if (type === "mluc") {
    const n = be32(b, at + 8);
    const rec = be32(b, at + 12);
    const out: { [k: string]: Json } = {};
    for (let i = 0; i < n && i < 64; i++) {
      const r = at + 16 + i * rec;
      const lang = `${ascii(b, r, 2)}-${ascii(b, r + 2, 2)}`;
      const len = be32(b, r + 4);
      const off = be32(b, r + 8);
      out[lang] = new TextDecoder("utf-16be")
        .decode(b.subarray(at + off, at + off + len))
        .replace(/\0+$/, "");
    }
    const vals = Object.values(out);
    return vals.length === 1 ? vals[0] : out;
  }
  return blob(b.subarray(at, at + size), size, type);
};

/** An ICC profile's header, its tag list and its texts. */
export const readIcc = (b: Uint8Array): Json => {
  if (b.length < 132) return blob(b);
  const v = b[8];
  const out: { [k: string]: Json } = {
    size: be32(b, 0),
    cmm: sig(b, 4),
    version: `${v}.${b[9] >> 4}.${b[9] & 0xf}`,
    class: sig(b, 12),
    colorSpace: sig(b, 16),
    pcs: sig(b, 20),
    created: `${be16(b, 24)}-${String(be16(b, 26)).padStart(2, "0")}-${String(be16(b, 28)).padStart(2, "0")}T${String(be16(b, 30)).padStart(2, "0")}:${String(be16(b, 32)).padStart(2, "0")}:${String(be16(b, 34)).padStart(2, "0")}`,
    platform: sig(b, 40),
    manufacturer: sig(b, 48),
    model: sig(b, 52),
    renderingIntent: be32(b, 64),
    creator: sig(b, 80),
  };
  const n = be32(b, 128);
  const tags: { [k: string]: Json } = {};
  for (let i = 0; i < n && i < 256 && 132 + i * 12 + 12 <= b.length; i++) {
    const e = 132 + i * 12;
    const name = sig(b, e);
    const at = be32(b, e + 4);
    const size = be32(b, e + 8);
    if (
      name === "desc" ||
      name === "cprt" ||
      name === "dmnd" ||
      name === "dmdd"
    ) {
      tags[name] = iccText(b, at, size);
    } else {
      tags[name] = { type: at + 4 <= b.length ? sig(b, at) : null, size };
    }
  }
  out.tags = tags;
  return out;
};

// ---------------------------------------------------------------------------
// Photoshop image resources and IPTC

const IPTC_NAMES: Record<string, string> = {
  "1:0": "EnvelopeRecordVersion",
  "1:90": "CodedCharacterSet",
  "2:0": "ApplicationRecordVersion",
  "2:5": "ObjectName",
  "2:15": "Category",
  "2:20": "SupplementalCategories",
  "2:25": "Keywords",
  "2:40": "SpecialInstructions",
  "2:55": "DateCreated",
  "2:60": "TimeCreated",
  "2:62": "DigitalCreationDate",
  "2:63": "DigitalCreationTime",
  "2:65": "OriginatingProgram",
  "2:70": "ProgramVersion",
  "2:80": "By-line",
  "2:85": "By-lineTitle",
  "2:90": "City",
  "2:92": "Sub-location",
  "2:95": "Province-State",
  "2:100": "Country-PrimaryLocationCode",
  "2:101": "Country-PrimaryLocationName",
  "2:103": "OriginalTransmissionReference",
  "2:105": "Headline",
  "2:110": "Credit",
  "2:115": "Source",
  "2:116": "CopyrightNotice",
  "2:118": "Contact",
  "2:120": "Caption-Abstract",
  "2:122": "Writer-Editor",
};

/** IPTC-NAA records: "Name (r:d)" → text (repeated ones as arrays). */
export const readIptc = (b: Uint8Array): Json => {
  const out: { [k: string]: Json } = {};
  let p = 0;
  while (p + 5 <= b.length && b[p] === 0x1c) {
    const rec = b[p + 1];
    const ds = b[p + 2];
    let len = be16(b, p + 3);
    let start = p + 5;
    if (len & 0x8000) {
      // Extended length: the next (len & 0x7fff) bytes hold it.
      const n = len & 0x7fff;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + b[start + i];
      start += n;
    }
    const id = `${rec}:${ds}`;
    const key = `${IPTC_NAMES[id] ?? "Dataset"} (${id})`;
    const raw = b.subarray(start, start + len);
    const v: Json =
      id === "1:90" || id === "1:0" || id === "2:0"
        ? hex(raw)
        : len > MAX_ASCII
          ? blob(raw)
          : text(raw);
    const cur = out[key];
    if (Array.isArray(cur)) cur.push(v);
    else out[key] = cur === undefined ? v : [cur, v];
    p = start + len;
  }
  return out;
};

const IRB_NAMES: Record<number, string> = {
  0x03ed: "ResolutionInfo",
  0x0404: "IPTC-NAA",
  0x0406: "JPEGQuality",
  0x040c: "Thumbnail",
  0x040f: "ICCProfile",
  0x0422: "EXIF",
  0x0424: "XMP",
  0x0425: "IPTCDigest",
};

/** Photoshop image resources (8BIM): IPTC decoded, the rest by head. */
export const readIrb = (
  b: Uint8Array,
): { iptc: Json | null; resources: Json } => {
  const resources: { [k: string]: Json } = {};
  let iptc: Json | null = null;
  let p = 0;
  while (p + 12 <= b.length && startsWith(b, "8BIM", p)) {
    const id = be16(b, p + 4);
    const nameLen = b[p + 6];
    let q = p + 7 + nameLen;
    if ((nameLen + 1) % 2) q++;
    const size = be32(b, q);
    const data = b.subarray(q + 4, q + 4 + size);
    const key = `${IRB_NAMES[id] ?? "Resource"} (0x${id.toString(16).padStart(4, "0")})`;
    if (id === 0x0404) iptc = readIptc(data);
    else if (id === 0x0425 || id === 0x0406) resources[key] = hex(data);
    else resources[key] = blob(data, size);
    p = q + 4 + size + (size % 2);
  }
  return { iptc, resources };
};

// ---------------------------------------------------------------------------
// JPEG

const SOF_NAMES: Record<number, string> = {
  0xc0: "Baseline",
  0xc1: "Extended sequential",
  0xc2: "Progressive",
  0xc3: "Lossless",
};

const marker = (m: number) =>
  m >= 0xe0 && m <= 0xef
    ? `APP${m - 0xe0}`
    : m === 0xfe
      ? "COM"
      : m === 0xdb
        ? "DQT"
        : m === 0xc4
          ? "DHT"
          : m === 0xdd
            ? "DRI"
            : m >= 0xc0 && m <= 0xcf
              ? `SOF${m - 0xc0}`
              : `0x${m.toString(16).toUpperCase()}`;

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT_NS = "http://ns.adobe.com/xmp/extension/\0";

const walkJpeg = async (f: RangedFile, sections: RawSection[]) => {
  const segments: Json[] = [];
  const icc: { seq: number; data: Uint8Array }[] = [];
  let iccAt = -1;
  const ext = new Map<string, { at: number; parts: Map<number, Uint8Array> }>();
  const irb: Uint8Array[] = [];
  let irbAt = -1;
  let p = 2;
  let truncated: string | null = null;
  try {
    for (;;) {
      const h = await f.get(p, 4);
      if (h.length < 4) break;
      if (h[0] !== 0xff) {
        truncated = `no marker at ${p}`;
        break;
      }
      const m = h[1];
      if (m === 0xff) {
        p++;
        continue;
      }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        p += 2;
        continue;
      }
      if (m === 0xd9) break;
      const len = be16(h, 2);
      const name = marker(m);
      if (segments.length >= MAX_SECTIONS || sections.length >= MAX_SECTIONS) {
        truncated = TOO_MANY;
        break;
      }
      segments.push(`${name} @${p} (${len + 2} bytes)`);
      if (m === 0xda) break; // The image data: no more metadata before it.
      const isMeta =
        (m >= 0xe0 && m <= 0xef) ||
        m === 0xfe ||
        (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc);
      if (isMeta) {
        const d = await f.get(p + 4, len - 2);
        const at = p;
        if (m === 0xe1 && startsWith(d, "Exif\0")) {
          sections.push({
            source: "EXIF",
            name,
            offset: at,
            data: readTiff(d.subarray(6)),
          });
        } else if (m === 0xe1 && startsWith(d, XMP_NS)) {
          sections.push({
            source: "XMP",
            name,
            offset: at,
            data: xmpData(utf8(d.subarray(XMP_NS.length))),
          });
        } else if (
          m === 0xe1 &&
          startsWith(d, XMP_EXT_NS) &&
          d.length >= XMP_EXT_NS.length + 40
        ) {
          const o = XMP_EXT_NS.length;
          const guid = ascii(d, o, 32);
          const e = ext.get(guid) ?? { at, parts: new Map() };
          e.parts.set(be32(d, o + 36), d.subarray(o + 40));
          ext.set(guid, e);
        } else if (
          m === 0xe2 &&
          startsWith(d, "ICC_PROFILE\0") &&
          d.length > 14
        ) {
          if (iccAt < 0) iccAt = at;
          icc.push({ seq: d[12], data: d.subarray(14) });
        } else if (m === 0xed && startsWith(d, "Photoshop 3.0\0")) {
          if (irbAt < 0) irbAt = at;
          irb.push(d.subarray(14));
        } else if (m === 0xe0 && startsWith(d, "JFIF\0") && d.length >= 14) {
          sections.push({
            source: "JFIF",
            name,
            offset: at,
            data: {
              version: `${d[5]}.${String(d[6]).padStart(2, "0")}`,
              units: d[7],
              xDensity: be16(d, 8),
              yDensity: be16(d, 10),
              thumbnail: `${d[12]}x${d[13]}`,
            },
          });
        } else if (m === 0xee && startsWith(d, "Adobe") && d.length >= 12) {
          sections.push({
            source: "Adobe",
            name,
            offset: at,
            data: {
              version: be16(d, 5),
              flags0: be16(d, 7),
              flags1: be16(d, 9),
              transform: d[11],
            },
          });
        } else if (m === 0xfe) {
          sections.push({
            source: "Comment",
            name,
            offset: at,
            data: maybeJson(text(d)),
          });
        } else if (m >= 0xc0 && m <= 0xcf) {
          sections.push({
            source: "JPEG",
            name,
            offset: at,
            data: {
              process: SOF_NAMES[m] ?? name,
              precision: d[0],
              height: be16(d, 1),
              width: be16(d, 3),
              components: d[5],
            },
          });
        } else {
          const z = indexOf0(d);
          const id =
            z > 0 && z < 64 && printable(ascii(d, 0, z))
              ? ascii(d, 0, z)
              : null;
          sections.push({
            source: "Other",
            name: id ? `${name} ${id}` : name,
            offset: at,
            data: blob(d, len - 2),
          });
        }
      }
      p += 2 + len;
    }
  } catch (e) {
    truncated = stopped(e, f, p);
  }
  if (icc.length) {
    icc.sort((a, b) => a.seq - b.seq);
    const all = new Uint8Array(icc.reduce((n, c) => n + c.data.length, 0));
    let o = 0;
    for (const c of icc) {
      all.set(c.data, o);
      o += c.data.length;
    }
    sections.push({
      source: "ICC",
      name: "APP2",
      offset: iccAt,
      data: readIcc(all),
    });
  }
  if (irb.length) {
    const all = new Uint8Array(irb.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of irb) {
      all.set(c, o);
      o += c.length;
    }
    const { iptc, resources } = readIrb(all);
    if (iptc)
      sections.push({
        source: "IPTC",
        name: "APP13",
        offset: irbAt,
        data: iptc,
      });
    sections.push({
      source: "Photoshop",
      name: "APP13",
      offset: irbAt,
      data: resources,
    });
  }
  for (const [guid, e] of ext) {
    const parts = [...e.parts].sort((a, b) => a[0] - b[0]).map(([, d]) => d);
    const xml = parts.map((d) => utf8(d)).join("");
    sections.push({
      source: "XMP",
      name: `APP1 extended ${guid}`,
      offset: e.at,
      data: xmpData(xml),
    });
  }
  sections.push({
    source: "JPEG",
    name: "segments",
    offset: 0,
    data: segments,
  });
  return truncated;
};

// ---------------------------------------------------------------------------
// PNG

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COLOR_TYPES: Record<number, string> = {
  0: "grayscale",
  2: "RGB",
  3: "indexed",
  4: "grayscale + alpha",
  6: "RGBA",
};

const textSection = (
  keyword: string,
  value: string,
  extra: { [k: string]: Json },
): Json => {
  if (keyword === "XML:com.adobe.xmp") return xmpData(value);
  return { keyword, ...extra, text: maybeJson(value) };
};

/** One PNG chunk's data, decoded. */
export const readPngChunk = async (
  type: string,
  d: Uint8Array,
): Promise<{ source: Source; data: Json }> => {
  const png = (data: Json) => ({ source: "PNG" as const, data });
  switch (type) {
    case "IHDR":
      return png({
        width: be32(d, 0),
        height: be32(d, 4),
        bitDepth: d[8],
        colorType: COLOR_TYPES[d[9]] ?? d[9],
        compression: d[10],
        filter: d[11],
        interlace: d[12] ? "Adam7" : "none",
      });
    case "tEXt": {
      const z = indexOf0(d);
      if (z < 0) return png(blob(d));
      const keyword = latin1(d.subarray(0, z));
      const value = text(d.subarray(z + 1));
      return {
        source: keyword === "XML:com.adobe.xmp" ? "XMP" : "PNG",
        data: textSection(keyword, value, {}),
      };
    }
    case "zTXt": {
      const z = indexOf0(d);
      if (z < 0) return png(blob(d));
      const keyword = latin1(d.subarray(0, z));
      const raw = await inflate(d.subarray(z + 2));
      if (!raw)
        return png({
          keyword,
          error: "could not inflate",
          ...(blob(d) as object),
        });
      return {
        source: keyword === "XML:com.adobe.xmp" ? "XMP" : "PNG",
        data: textSection(keyword, text(raw), { compressed: true }),
      };
    }
    case "iTXt": {
      const z = indexOf0(d);
      if (z < 0 || z + 3 > d.length) return png(blob(d));
      const keyword = latin1(d.subarray(0, z));
      const compressed = d[z + 1] === 1;
      const l = indexOf0(d, z + 3);
      const t = l < 0 ? -1 : indexOf0(d, l + 1);
      if (t < 0) return png(blob(d));
      const lang = latin1(d.subarray(z + 3, l));
      const translated = utf8(d.subarray(l + 1, t));
      let body: Uint8Array | null = d.subarray(t + 1);
      if (compressed) body = await inflate(body);
      if (!body)
        return png({
          keyword,
          error: "could not inflate",
          ...(blob(d) as object),
        });
      const extra: { [k: string]: Json } = {};
      if (compressed) extra.compressed = true;
      if (lang) extra.language = lang;
      if (translated) extra.translatedKeyword = translated;
      return {
        source: keyword === "XML:com.adobe.xmp" ? "XMP" : "PNG",
        data: textSection(keyword, utf8(body), extra),
      };
    }
    case "eXIf":
      return { source: "EXIF", data: readTiff(d) };
    case "iCCP": {
      const z = indexOf0(d);
      const raw = z < 0 ? null : await inflate(d.subarray(z + 2));
      if (!raw) return png(blob(d));
      const data = readIcc(raw);
      return {
        source: "ICC",
        data:
          typeof data === "object" && data && !Array.isArray(data)
            ? { name: latin1(d.subarray(0, z)), ...data }
            : data,
      };
    }
    case "pHYs":
      return png({
        x: be32(d, 0),
        y: be32(d, 4),
        unit: d[8] === 1 ? "metre" : "unknown",
      });
    case "tIME":
      return png(
        `${be16(d, 0)}-${String(d[2]).padStart(2, "0")}-${String(d[3]).padStart(2, "0")}T${String(d[4]).padStart(2, "0")}:${String(d[5]).padStart(2, "0")}:${String(d[6]).padStart(2, "0")}Z`,
      );
    case "sRGB":
      return png({
        renderingIntent:
          [
            "perceptual",
            "relative colorimetric",
            "saturation",
            "absolute colorimetric",
          ][d[0]] ?? d[0],
      });
    case "gAMA":
      return png(be32(d, 0) / 100000);
    case "cHRM": {
      const v = (i: number) => be32(d, i * 4) / 100000;
      return png({
        whitePoint: [v(0), v(1)],
        red: [v(2), v(3)],
        green: [v(4), v(5)],
        blue: [v(6), v(7)],
      });
    }
    case "cICP":
      return png({
        colourPrimaries: d[0],
        transferFunction: d[1],
        matrixCoefficients: d[2],
        videoFullRange: d[3],
      });
    case "acTL":
      return png({ frames: be32(d, 0), plays: be32(d, 4) });
    case "sBIT":
    case "bKGD":
      return png(Array.from(d));
    case "PLTE":
      return png({ entries: d.length / 3 });
    case "IEND":
      return png(null);
    default:
      return png(blob(d));
  }
};

const isChunkType = (b: Uint8Array, at: number) => {
  for (let i = 0; i < 4; i++) {
    const c = b[at + i];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return false;
  }
  return true;
};

/** Bytes a resync may check CRCs over (a crafted tail must not spin). */
const MAX_SYNC_CRC_BYTES = 8 * 1024 * 1024;

/**
 * In the file's last bytes (from `base`), the first chunk from which a
 * chain of chunks with good CRCs reaches IEND (bytes after IEND, which
 * some tools append, are allowed); -1 if there is none. Each position is
 * walked once.
 */
export const syncPngTail = (tail: Uint8Array, base: number): number => {
  // 0 unknown, 1 reaches IEND, -1 does not.
  const memo = new Int8Array(tail.length);
  let crcBytes = 0;
  for (let s = 0; s + 12 <= tail.length; s++) {
    const path: number[] = [];
    let p = s;
    let result = -1;
    while (p + 12 <= tail.length) {
      if (memo[p]) {
        result = memo[p];
        break;
      }
      if (!isChunkType(tail, p + 4)) break;
      const len = be32(tail, p);
      const end = p + 12 + len;
      if (end > tail.length) break;
      crcBytes += len + 4;
      if (crcBytes > MAX_SYNC_CRC_BYTES) return -1;
      if (
        crc32(tail.subarray(p + 4, p + 8 + len)) !== be32(tail, p + 8 + len)
      ) {
        break;
      }
      path.push(p);
      if (ascii(tail, p + 4, 4) === "IEND") {
        result = 1;
        break;
      }
      p = end;
    }
    for (const q of path) memo[q] = result;
    if (!memo[s]) memo[s] = -1;
    if (memo[s] === 1) return base + s;
  }
  return -1;
};

const walkPng = async (f: RangedFile, sections: RawSection[]) => {
  let p = 8;
  let idat = { count: 0, bytes: 0, offset: -1, skipped: 0 };
  let truncated: string | null = null;
  let tailFrom = -1;
  const flushIdat = () => {
    if (idat.count) {
      sections.push({
        source: "PNG",
        name: "IDAT",
        offset: idat.offset,
        data: idat.skipped
          ? {
              chunks: idat.count,
              bytes: idat.bytes,
              // Image data between the walk and the end, not walked.
              skipped: idat.skipped,
            }
          : { chunks: idat.count, bytes: idat.bytes },
      });
      idat = { count: 0, bytes: 0, offset: -1, skipped: 0 };
    }
  };
  try {
    while (p + 12 <= f.size) {
      // One read is kept for the file's end, where text chunks may follow
      // many small IDATs this walk would not get through.
      if (!f.covered(p, 8) && f.readsLeft <= 1 && tailFrom < 0) {
        const base = await f.readTail();
        const at = syncPngTail(await f.get(base, f.size - base), base);
        tailFrom = base;
        if (at < 0) {
          truncated = `read limit (${f.maxReads} reads) reached at byte ${p}`;
          break;
        }
        // The tail reaches back to where the walk is: go on from there.
        if (at <= p) continue;
        const first = ascii(await f.get(at, 8), 4, 4);
        // IDATs are consecutive: the bytes up to another IDAT are image
        // data; up to anything else, they may hold a chunk not seen.
        if (first === "IDAT" && idat.count) idat.skipped += at - p;
        else truncated = `bytes ${p}–${at} not read`;
        p = at;
        continue;
      }
      const h = await f.get(p, 8);
      const len = be32(h, 0);
      const type = ascii(h, 4, 4);
      if (!isChunkType(h, 4)) {
        truncated = `no chunk at byte ${p}`;
        break;
      }
      if (type === "IDAT" || type === "fdAT") {
        if (idat.offset < 0) idat.offset = p;
        idat.count++;
        idat.bytes += len;
      } else {
        flushIdat();
        if (sections.length >= MAX_SECTIONS) {
          truncated = TOO_MANY;
          break;
        }
        let take = Math.min(len, MAX_ITEM_BYTES);
        // A big chunk must not use the read kept for the file's end: then
        // only what is already read of it is shown.
        if (
          tailFrom < 0 &&
          !f.covered(p + 8, take) &&
          Math.ceil(take / MAX_READ_BYTES) + 1 >= f.readsLeft
        ) {
          take = 0;
          while (
            take < Math.min(len, HEAD_BYTES) &&
            f.covered(p + 8, take + 1)
          ) {
            take++;
          }
        }
        const d = await f.get(p + 8, take);
        const { source, data } =
          len > take
            ? { source: "PNG" as const, data: blob(d, len) }
            : await readPngChunk(type, d);
        sections.push({ source, name: type, offset: p, data });
        if (type === "IEND") break;
      }
      p += 12 + len;
    }
  } catch (e) {
    truncated = stopped(e, f, p);
  }
  flushIdat();
  return truncated;
};

// ---------------------------------------------------------------------------
// WebP

const walkWebp = async (f: RangedFile, sections: RawSection[]) => {
  let p = 12;
  let truncated: string | null = null;
  const end = Math.min(f.size, 8 + le32(await f.get(4, 4), 0));
  try {
    while (p + 8 <= end) {
      if (sections.length >= MAX_SECTIONS) {
        truncated = TOO_MANY;
        break;
      }
      const h = await f.get(p, 8);
      const type = ascii(h, 0, 4);
      const len = le32(h, 4);
      const image =
        type === "VP8 " ||
        type === "VP8L" ||
        type === "ALPH" ||
        type === "ANMF";
      if (image) {
        let data: Json = { size: len };
        if (type === "VP8L") {
          const d = await f.get(p + 8, 5);
          const bits = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24);
          data = {
            size: len,
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
          };
        } else if (type === "VP8 ") {
          const d = await f.get(p + 8, 10);
          data = {
            size: len,
            width: (d[6] | (d[7] << 8)) & 0x3fff,
            height: (d[8] | (d[9] << 8)) & 0x3fff,
          };
        }
        sections.push({ source: "WebP", name: type, offset: p, data });
      } else {
        const take = Math.min(len, MAX_ITEM_BYTES);
        const d = await f.get(p + 8, take);
        if (len > take)
          sections.push({
            source: "WebP",
            name: type,
            offset: p,
            data: blob(d, len),
          });
        else if (type === "EXIF") {
          // Some writers keep the "Exif\0\0" of JPEG's APP1.
          const t = startsWith(d, "Exif\0") ? d.subarray(6) : d;
          sections.push({
            source: "EXIF",
            name: type,
            offset: p,
            data: readTiff(t),
          });
        } else if (type === "XMP ") {
          sections.push({
            source: "XMP",
            name: type,
            offset: p,
            data: xmpData(utf8(d)),
          });
        } else if (type === "ICCP") {
          sections.push({
            source: "ICC",
            name: type,
            offset: p,
            data: readIcc(d),
          });
        } else if (type === "VP8X") {
          sections.push({
            source: "WebP",
            name: type,
            offset: p,
            data: {
              flags: d[0],
              width: 1 + (d[4] | (d[5] << 8) | (d[6] << 16)),
              height: 1 + (d[7] | (d[8] << 8) | (d[9] << 16)),
            },
          });
        } else {
          sections.push({
            source: "WebP",
            name: type,
            offset: p,
            data: blob(d, len),
          });
        }
      }
      p += 8 + len + (len % 2);
    }
  } catch (e) {
    truncated = stopped(e, f, p);
  }
  return truncated;
};

// ---------------------------------------------------------------------------

/**
 * Everything in the file's metadata, read with `read`; null when there is
 * no such file.
 */
export const readRawMeta = async (
  read: RangeRead,
  maxReads = MAX_READS,
): Promise<RawMeta | null> => {
  const f = new RangedFile(read, maxReads);
  if (!(await f.open())) return null;
  const head = await f.get(0, 12);
  const sections: RawSection[] = [];
  let format: RawMeta["format"] = "unknown";
  let truncated: string | null = null;
  if (PNG_SIG.every((v, i) => head[i] === v)) {
    format = "png";
    truncated = await walkPng(f, sections);
  } else if (head[0] === 0xff && head[1] === 0xd8) {
    format = "jpeg";
    truncated = await walkJpeg(f, sections);
  } else if (startsWith(head, "RIFF") && startsWith(head, "WEBP", 8)) {
    format = "webp";
    truncated = await walkWebp(f, sections);
  } else {
    sections.push({
      source: "File",
      name: "head",
      offset: 0,
      data: blob(head, f.size),
    });
  }
  return { format, size: f.size, sections, reads: f.reads, truncated };
};
