// What an uploaded video says about itself (size, length, codec, when and
// where it was taken, the device), and how to make its playback copy: the
// same bytes with the metadata taken out. No dependencies; runs in the
// browser (on a File, through `read`) and in Node (tests).
// Covered by video-meta.spec.ts.
//
// The original goes to B2 as it is and is never served. The public site
// plays a copy, which must not carry anything the photo's public levels
// may hide: a position, the phone's make and model, the time it was taken.
// The copy is made without re-encoding and without moving a byte, so
// every offset in the file (MP4 chunk offsets, WebM cue and seek
// positions) stays valid and the copy has exactly the original's size:
//
// - MP4 / MOV (ISO BMFF): every `udta`, `meta` and `uuid` box at the top
//   level, in `moov`, in each `trak` and in its `mdia` becomes a `free`
//   box of zeros of the same size (players skip `free` boxes; the
//   contents are zeroed too, so the text is not just hidden from players
//   but gone from the file), so QuickTime's ©xyz / ©mak / ©mod, Apple's
//   `mdta` keys (location, make, model, creationdate, software) and XMP
//   packets are gone. The creation and
//   modification times of `mvhd`, every `tkhd` and every `mdhd` are
//   zeroed ("unknown"). ftyp, mdat and the sample tables are untouched.
// - WebM / Matroska (EBML): `Tags` (where muxers put locations and
//   devices), `Attachments` (cover art and the like), and in `Info` the
//   `Title`, `DateUTC`, `MuxingApp` and `WritingApp`, and each track's
//   `Name`, become an EBML `Void` element of the same total length (ID
//   0xEC, a size vint of 1 byte when it fits, else 8, then zeros). Players
//   skip Void anywhere; a SeekHead entry pointing at the old Tags now
//   points at a Void, which players also accept.
//
// Reading touches only what it needs: the headers of top-level boxes or
// elements (never the media data: mdat, Clusters), `moov` in full (capped
// at MAX_MOOV_BYTES), and in WebM the Info, Tracks, Tags and Attachments
// headers it found directly or through the SeekHead.

export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;
export type VideoContainer = "mp4" | "mov" | "webm";
export type BytePatch = { offset: number; bytes: Uint8Array };
export type VideoMeta = {
  container: VideoContainer;
  /** Of the first video track, as displayed (a 90° rotation swaps them). */
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** "avc1.640028" for H.264 (from avcC), else the sample entry's fourcc
   * ("hvc1", "hev1", "av01", "vp09", "mp4v"), or "vp8" / "vp9" / "av1". */
  codec: string | null;
  /**
   * When it was taken: Apple's com.apple.quicktime.creationdate with its
   * own offset ("exif", the file's statement of the shooting time), else
   * the container's creation time (UTC, shown in JST like other times
   * without an offset; "file_date").
   */
  takenAt: { at: string; source: "exif" | "file_date" } | null;
  location: { latitude: number; longitude: number } | null;
  make: string | null;
  model: string | null;
  /** Turn the original into the playback copy (same total size). */
  patches: BytePatch[];
};

/** Thrown for a file that looks like a video but cannot be read. */
export class VideoMetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoMetaError";
  }
}

/** Largest `moov` read into memory (it holds only tables and metadata). */
export const MAX_MOOV_BYTES = 64 * 1024 * 1024;
/** Largest WebM metadata element (Info, Tracks, Tags) read. */
const MAX_EBML_ELEMENT_BYTES = 16 * 1024 * 1024;
/** Most top-level boxes / elements looked at (bounds a corrupt file). */
const MAX_TOP_LEVEL = 100_000;

const latin1 = (b: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...b.subarray(start, end));
const utf8 = (b: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: false }).decode(b);
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const i32 = (b: Uint8Array, o: number) => u32(b, o) | 0;

/** MP4, MOV or WebM by the first bytes, or null. */
export const videoContainerOf = (head: Uint8Array): VideoContainer | null => {
  if (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return "webm";
  }
  if (head.length < 8) return null;
  const type = latin1(head, 4, 8);
  if (type === "ftyp") {
    return head.length >= 12 && latin1(head, 8, 12) === "qt  " ? "mov" : "mp4";
  }
  // Old QuickTime files have no ftyp.
  return ["moov", "mdat", "wide", "free", "skip", "pnot"].includes(type)
    ? "mov"
    : null;
};

/** A copy of `bytes` with the patches applied. */
export const applyPatches = (
  bytes: Uint8Array,
  patches: readonly BytePatch[],
): Uint8Array => {
  const out = new Uint8Array(bytes);
  for (const p of patches) {
    if (p.offset < 0 || p.offset + p.bytes.length > out.length) {
      throw new RangeError("patch outside the file");
    }
    out.set(p.bytes, p.offset);
  }
  return out;
};

export const readVideoMeta = async (
  size: number,
  read: ReadAt,
): Promise<VideoMeta | null> => {
  if (size < 8) return null;
  const head = await read(0, Math.min(size, 12));
  const container = videoContainerOf(head);
  if (container === "webm") return readWebm(size, read);
  if (container === null) return null;
  return readIsoBmff(size, read, container);
};

// --- dates and places -----------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Unix ms as an ISO time in JST ("+09:00"). */
const jstIso = (ms: number): string => {
  const d = new Date(ms + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`;
};

/** Seconds between 1904-01-01 and 1970-01-01 (QuickTime's epoch). */
const QT_EPOCH_OFFSET = 2_082_844_800;

/** A QuickTime time (seconds since 1904, UTC) in JST; null when unset. */
export const qtTimeToIso = (seconds: number): string | null => {
  const unix = seconds - QT_EPOCH_OFFSET;
  // 0 is "unknown"; anything before 1990 is an unset clock.
  if (seconds === 0 || unix < 631_152_000) return null;
  if (unix > 253_402_300_799) return null;
  return jstIso(unix * 1000);
};

/**
 * Apple's creationdate ("2026-11-18T10:20:30+0900", sometimes with
 * fractions) as ISO 8601 with a "+09:00" offset; null when it is not one.
 */
export const appleDateToIso = (raw: string): string | null => {
  const m =
    /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  const frac = m[2] ? `.${m[2].slice(0, 3)}` : "";
  const off = m[3] === "Z" ? "Z" : `${m[3].slice(0, 3)}:${m[3].slice(-2)}`;
  const iso = `${m[1]}${frac}${off}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
};

/** An ISO 6709 position ("+35.6895+139.6917+040.000/") in degrees. */
export const parseIso6709 = (
  raw: string,
): { latitude: number; longitude: number } | null => {
  const m = /^\s*([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }
  return { latitude, longitude };
};

const cleanText = (s: string | null | undefined): string | null => {
  // eslint-disable-next-line no-control-regex
  const t = s?.replace(/\u0000+$/, "").trim();
  return t ? t.slice(0, 200) : null;
};

// --- MP4 / MOV ------------------------------------------------------------

type Box = {
  type: string;
  /** Offset of the box in its buffer (or the file). */
  start: number;
  /** Payload offset. */
  body: number;
  end: number;
};

/** The boxes in buf[from, to); stops at anything malformed. */
const childBoxes = (buf: Uint8Array, from: number, to: number): Box[] => {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to && out.length < MAX_TOP_LEVEL) {
    let size = u32(buf, o);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = u64(buf, o + 8);
      header = 16;
    } else if (size === 0) {
      size = to - o;
    }
    // A zero terminator (QuickTime udta) or garbage ends the list.
    if (size < header || o + size > to) break;
    out.push({
      type: latin1(buf, o + 4, o + 8),
      start: o,
      body: o + header,
      end: o + size,
    });
    o += size;
  }
  return out;
};

/**
 * Where a `meta` box's children start: QuickTime's meta has none of ISO's
 * version/flags, so its first child (hdlr) begins right away.
 */
const metaChildren = (buf: Uint8Array, box: Box): number =>
  box.body + 8 <= box.end && latin1(buf, box.body + 4, box.body + 8) === "hdlr"
    ? box.body
    : box.body + 4;

const STRIP = new Set(["udta", "meta", "uuid"]);

/**
 * The top-level boxes a playback copy keeps as they are (the file type,
 * the movie, its media data); every other one is blanked. moof / mfra
 * (fragments) are refused.
 */
const KEEP_TOP_LEVEL = new Set(["ftyp", "moov", "mdat"]);
/** Padding boxes: kept when their contents are all zeros. */
const EMPTY_TOP_LEVEL = new Set(["free", "skip", "wide"]);
const FREE = [0x66, 0x72, 0x65, 0x65]; // "free"

/** Make `box` (in buf) a `free` box of zeros, same size. */
const strip = (buf: Uint8Array, box: Box) => {
  buf.set(FREE, box.start + 4);
  buf.fill(0, box.body, box.end);
};

/**
 * The patch that turns a top-level box of the file into zeros under a
 * `free` header (its header kept, 64-bit size included).
 */
const stripPatches = (box: Box): BytePatch[] => {
  if (box.end - box.start > MAX_MOOV_BYTES) {
    throw new VideoMetaError("動画のメタデータが大きすぎて消せません");
  }
  // One patch, unless a 64-bit size sits between the type and the body.
  if (box.body - box.start === 8) {
    const bytes = new Uint8Array(box.end - box.start - 4);
    bytes.set(FREE, 0);
    return [{ offset: box.start + 4, bytes }];
  }
  return [
    { offset: box.start + 4, bytes: new Uint8Array(FREE) },
    { offset: box.body, bytes: new Uint8Array(box.end - box.body) },
  ];
};

/** QuickTime user data text ("©xyz" etc.): 16-bit length, language, text. */
const udtaText = (buf: Uint8Array, box: Box): string | null => {
  if (box.body + 4 > box.end) return null;
  const len = u16(buf, box.body);
  const start = box.body + 4;
  const end = Math.min(box.end, start + len);
  // Some writers use an ISO `data` box instead.
  if (
    box.body + 8 <= box.end &&
    latin1(buf, box.body + 4, box.body + 8) === "data"
  ) {
    return dataText(buf, box);
  }
  return cleanText(utf8(buf.subarray(start, end)));
};

/** The UTF-8 value of the `data` box inside an ilst item (or ©xxx). */
const dataText = (buf: Uint8Array, item: Box): string | null => {
  for (const d of childBoxes(buf, item.body, item.end)) {
    if (d.type !== "data" || d.body + 8 > d.end) continue;
    // Well-known types 1 (UTF-8) and 2 (UTF-16) are text.
    const type = u32(buf, d.body) & 0xffffff;
    const value = buf.subarray(d.body + 8, d.end);
    if (type === 1) return cleanText(utf8(value));
    if (type === 2) {
      return cleanText(new TextDecoder("utf-16be").decode(value));
    }
  }
  return null;
};

type Found = {
  apple: Map<string, string>;
  udta: Map<string, string>;
  mvhd: { created: number; timescale: number; duration: number } | null;
  tracks: {
    video: boolean;
    width: number;
    height: number;
    rotated: boolean;
    codec: string | null;
    sampleWidth: number;
    sampleHeight: number;
    timescale: number;
    duration: number;
    /** mdia/hdlr's handler type ("vide", "soun", "meta", "tmcd", …). */
    handler: string | null;
    /** A track that is not picture or sound: its samples' bytes in the file. */
    dataRanges: { offset: number; size: number }[];
  }[];
};

/** Apple's `mdta` keys + ilst values inside a meta box. */
const readAppleMeta = (
  buf: Uint8Array,
  meta: Box,
  into: Map<string, string>,
) => {
  const kids = childBoxes(buf, metaChildren(buf, meta), meta.end);
  const keys = kids.find((b) => b.type === "keys");
  const ilst = kids.find((b) => b.type === "ilst");
  if (!keys || !ilst || keys.body + 8 > keys.end) return;
  const names: string[] = [];
  const count = u32(buf, keys.body + 4);
  let o = keys.body + 8;
  for (let i = 0; i < count && o + 8 <= keys.end; i++) {
    const size = u32(buf, o);
    if (size < 8 || o + size > keys.end) break;
    names.push(latin1(buf, o + 8, o + size));
    o += size;
  }
  for (const item of childBoxes(buf, ilst.body, ilst.end)) {
    const index = u32(buf, item.start + 4);
    const name = names[index - 1];
    if (!name) continue;
    const value = dataText(buf, item);
    if (value !== null && !into.has(name)) into.set(name, value);
  }
};

const zeroTimes = (buf: Uint8Array, box: Box) => {
  // version 0: 32-bit creation + modification; 1: 64-bit each.
  const v = buf[box.body];
  buf.fill(0, box.body + 4, box.body + 4 + (v === 1 ? 16 : 8));
};

/** Read and neutralise one moov (in place in `buf`). */
const walkMoov = (buf: Uint8Array, moov: Box, found: Found) => {
  for (const b of childBoxes(buf, moov.body, moov.end)) {
    if (b.type === "mvhd" && b.body + 24 <= b.end) {
      const v1 = buf[b.body] === 1;
      found.mvhd = v1
        ? {
            created: u64(buf, b.body + 4),
            timescale: u32(buf, b.body + 20),
            duration: u64(buf, b.body + 24),
          }
        : {
            created: u32(buf, b.body + 4),
            timescale: u32(buf, b.body + 12),
            duration: u32(buf, b.body + 16),
          };
      zeroTimes(buf, b);
    } else if (b.type === "trak") {
      walkTrak(buf, b, found);
    } else if (STRIP.has(b.type)) {
      readUserData(buf, b, found);
      strip(buf, b);
    } else if (!KEEP_IN_MOOV.has(b.type)) {
      // Anything else a writer put in the movie (a vendor's box): gone.
      strip(buf, b);
    }
  }
};

/** moov / trak / mdia / minf children a copy keeps (the rest is blanked). */
const KEEP_IN_MOOV = new Set(["mvhd", "trak", "mvex", "iods"]);
const KEEP_IN_TRAK = new Set(["tkhd", "mdia", "edts", "tref"]);
const KEEP_IN_MDIA = new Set(["mdhd", "hdlr", "minf"]);
const KEEP_IN_MINF = new Set(["vmhd", "smhd", "nmhd", "dinf", "stbl", "hdlr"]);

/**
 * A handler's name is free text ("GoPro AVC", "DJI.AVC"): zeroed, the
 * handler type kept. hdlr: version/flags, pre_defined, type, 12 reserved,
 * then the name.
 */
const zeroHandlerName = (buf: Uint8Array, hdlr: Box) => {
  if (hdlr.body + 24 < hdlr.end) buf.fill(0, hdlr.body + 24, hdlr.end);
};

/** Metadata inside a udta / meta box (any depth that matters). */
const readUserData = (buf: Uint8Array, box: Box, found: Found) => {
  if (box.type === "meta") {
    readAppleMeta(buf, box, found.apple);
    return;
  }
  if (box.type !== "udta") return;
  for (const c of childBoxes(buf, box.body, box.end)) {
    if (c.type === "meta") readAppleMeta(buf, c, found.apple);
    else if (c.type.charCodeAt(0) === 0xa9 && !found.udta.has(c.type)) {
      const text = udtaText(buf, c);
      if (text !== null) found.udta.set(c.type, text);
    }
  }
};

const walkTrak = (buf: Uint8Array, trak: Box, found: Found) => {
  const t: Found["tracks"][number] = {
    video: false,
    width: 0,
    height: 0,
    rotated: false,
    codec: null,
    sampleWidth: 0,
    sampleHeight: 0,
    timescale: 0,
    duration: 0,
    handler: null,
    dataRanges: [],
  };
  let stbl: Box | null = null;
  for (const b of childBoxes(buf, trak.body, trak.end)) {
    if (b.type === "tkhd" && b.body + 84 <= b.end) {
      const v1 = buf[b.body] === 1;
      // After the times, id, reserved, duration, 8 reserved, layer,
      // alternate group, volume, reserved: the matrix, then the size.
      const matrix = b.body + 4 + (v1 ? 32 : 20) + 16;
      if (matrix + 44 <= b.end) {
        const a = i32(buf, matrix);
        const bb = i32(buf, matrix + 4);
        t.rotated = a === 0 && Math.abs(bb) === 0x10000;
        t.width = Math.round(u32(buf, matrix + 36) / 65536);
        t.height = Math.round(u32(buf, matrix + 40) / 65536);
      }
      zeroTimes(buf, b);
    } else if (b.type === "mdia") {
      // The handler first, whatever the order: the sample entry is read
      // as a visual one only for a picture track.
      const hd = childBoxes(buf, b.body, b.end).find(
        (m) => m.type === "hdlr" && m.body + 12 <= m.end,
      );
      if (hd) {
        t.handler = latin1(buf, hd.body + 8, hd.body + 12);
        t.video = t.handler === "vide";
      }
      for (const m of childBoxes(buf, b.body, b.end)) {
        if (m.type === "mdhd" && m.body + 24 <= m.end) {
          const v1 = buf[m.body] === 1;
          t.timescale = u32(buf, m.body + (v1 ? 20 : 12));
          t.duration = v1 ? u64(buf, m.body + 24) : u32(buf, m.body + 16);
          zeroTimes(buf, m);
        } else if (m.type === "hdlr" && m.body + 12 <= m.end) {
          t.handler = latin1(buf, m.body + 8, m.body + 12);
          t.video = t.handler === "vide";
          zeroHandlerName(buf, m);
        } else if (m.type === "minf") {
          readSampleEntry(buf, m, t);
          stbl =
            childBoxes(buf, m.body, m.end).find((x) => x.type === "stbl") ??
            null;
          for (const x of childBoxes(buf, m.body, m.end)) {
            if (x.type === "hdlr") zeroHandlerName(buf, x);
            else if (!KEEP_IN_MINF.has(x.type)) strip(buf, x);
          }
        } else if (STRIP.has(m.type)) {
          readUserData(buf, m, found);
          strip(buf, m);
        } else if (!KEEP_IN_MDIA.has(m.type)) {
          strip(buf, m);
        }
      }
    } else if (STRIP.has(b.type)) {
      readUserData(buf, b, found);
      strip(buf, b);
    } else if (!KEEP_IN_TRAK.has(b.type)) {
      strip(buf, b);
    }
  }
  // Anything but picture and sound (timed metadata: GoPro's GPMF, DJI's
  // and Sony's tracks, Google's camm, Apple's mebx, a timecode's time of
  // day; subtitles a drone writes its position into): its samples are
  // zeroed in the file and the track itself becomes a `free` box, so
  // players never see it and its bytes are gone.
  if (t.handler !== "vide" && t.handler !== "soun") {
    t.dataRanges = stbl ? sampleRanges(buf, stbl) : [];
    strip(buf, trak);
  }
  found.tracks.push(t);
};

/**
 * Where a track's samples are in the file, chunk by chunk (stco / co64,
 * stsc, stsz), adjacent chunks merged. Throws on tables that do not add
 * up, rather than leaving bytes in place.
 */
const sampleRanges = (
  buf: Uint8Array,
  stbl: Box,
): { offset: number; size: number }[] => {
  const kids = childBoxes(buf, stbl.body, stbl.end);
  const box = (type: string) => kids.find((b) => b.type === type);
  const stco = box("stco");
  const co64 = box("co64");
  const stsc = box("stsc");
  const stsz = box("stsz");
  const bad = () =>
    new VideoMetaError("動画のメタデータのトラックを読めません");
  if (!stsc || !stsz || (!stco && !co64)) {
    // No samples to point at: nothing in the file to clear.
    if (!stco && !co64) return [];
    throw bad();
  }
  const offsets: number[] = [];
  const co = (stco ?? co64)!;
  const wide = !stco;
  const nChunks = u32(buf, co.body + 4);
  if (co.body + 8 + nChunks * (wide ? 8 : 4) > co.end) throw bad();
  for (let i = 0; i < nChunks; i++) {
    const at = co.body + 8 + i * (wide ? 8 : 4);
    offsets.push(wide ? u64(buf, at) : u32(buf, at));
  }
  // Samples per chunk, from the runs of stsc.
  const nRuns = u32(buf, stsc.body + 4);
  if (stsc.body + 8 + nRuns * 12 > stsc.end) throw bad();
  const perChunk: number[] = [];
  for (let r = 0; r < nRuns; r++) {
    const at = stsc.body + 8 + r * 12;
    const first = u32(buf, at);
    const count = u32(buf, at + 4);
    const next =
      r + 1 < nRuns ? u32(buf, stsc.body + 8 + (r + 1) * 12) : nChunks + 1;
    if (first < 1 || next < first) throw bad();
    for (let c = first; c < next && c <= nChunks; c++) perChunk[c - 1] = count;
  }
  const fixed = u32(buf, stsz.body + 4);
  const nSamples = u32(buf, stsz.body + 8);
  if (fixed === 0 && stsz.body + 12 + nSamples * 4 > stsz.end) throw bad();
  const ranges: { offset: number; size: number }[] = [];
  let sample = 0;
  for (let c = 0; c < nChunks; c++) {
    let size = 0;
    for (let k = 0; k < (perChunk[c] ?? 0); k++, sample++) {
      if (sample >= nSamples) throw bad();
      size += fixed || u32(buf, stsz.body + 12 + sample * 4);
    }
    const last = ranges[ranges.length - 1];
    if (last && last.offset + last.size === offsets[c]) last.size += size;
    else if (size > 0) ranges.push({ offset: offsets[c], size });
  }
  return ranges;
};

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** minf/stbl/stsd: the first sample entry's codec and size. */
const readSampleEntry = (
  buf: Uint8Array,
  minf: Box,
  t: Found["tracks"][number],
) => {
  const stbl = childBoxes(buf, minf.body, minf.end).find(
    (b) => b.type === "stbl",
  );
  if (!stbl) return;
  const stsd = childBoxes(buf, stbl.body, stbl.end).find(
    (b) => b.type === "stsd",
  );
  if (!stsd) return;
  const entry = childBoxes(buf, stsd.body + 8, stsd.end)[0];
  if (!entry) return;
  t.codec = entry.type.replace(/[^\x21-\x7e]/g, "") || null;
  // Only a picture track's entry is a visual one: a sound entry's bytes
  // there are its codec's settings, never touched.
  if (t.handler !== "vide") return;
  // A visual sample entry: 6 reserved, data ref index, 16 bytes, then
  // width and height, ..., 78 bytes before its child boxes.
  if (entry.body + 78 > entry.end) return;
  t.sampleWidth = u16(buf, entry.body + 24);
  t.sampleHeight = u16(buf, entry.body + 26);
  // The encoder's name (32 bytes; "GoPro AVC encoder"…): zeroed.
  buf.fill(0, entry.body + 42, entry.body + 74);
  if (entry.type === "avc1" || entry.type === "avc3") {
    const avcC = childBoxes(buf, entry.body + 78, entry.end).find(
      (b) => b.type === "avcC",
    );
    if (avcC && avcC.body + 4 <= avcC.end) {
      t.codec = `${entry.type}.${hex2(buf[avcC.body + 1])}${hex2(buf[avcC.body + 2])}${hex2(buf[avcC.body + 3])}`;
    }
  }
};

/** Read one box header at `offset` of the file (8 bytes, 16 if needed). */
const readBoxHeader = async (
  size: number,
  read: ReadAt,
  offset: number,
): Promise<Box | null> => {
  if (offset + 8 > size) return null;
  const h = await read(offset, 8);
  if (h.length < 8) return null;
  let boxSize = u32(h, 0);
  let header = 8;
  if (boxSize === 1) {
    if (offset + 16 > size) return null;
    const big = await read(offset + 8, 8);
    if (big.length < 8) return null;
    boxSize = u64(big, 0);
    header = 16;
  } else if (boxSize === 0) {
    boxSize = size - offset;
  }
  if (boxSize < header) return null;
  return {
    type: latin1(h, 4, 8),
    start: offset,
    body: offset + header,
    end: offset + boxSize,
  };
};

const readIsoBmff = async (
  size: number,
  read: ReadAt,
  container: "mp4" | "mov",
): Promise<VideoMeta> => {
  const patches: BytePatch[] = [];
  const found: Found = {
    apple: new Map(),
    udta: new Map(),
    mvhd: null,
    tracks: [],
  };
  let sawMoov = false;
  let offset = 0;
  for (let n = 0; n < MAX_TOP_LEVEL; n++) {
    const box = await readBoxHeader(size, read, offset);
    if (!box) break;
    if (box.end > size) {
      if (box.type === "moov") {
        throw new VideoMetaError("動画ファイルが途中で切れています");
      }
      // A box cut short at the end: cleared with the rest below.
      break;
    }
    if (box.type === "moov" && !sawMoov) {
      sawMoov = true;
      const length = box.end - box.start;
      if (length > MAX_MOOV_BYTES) {
        throw new VideoMetaError("動画の moov が大きすぎて読めません");
      }
      const buf = new Uint8Array(await read(box.start, length));
      if (buf.length < length) {
        throw new VideoMetaError("動画ファイルが途中で切れています");
      }
      const original = buf.slice();
      walkMoov(
        buf,
        { ...box, start: 0, body: box.body - box.start, end: length },
        found,
      );
      // One patch for every change in moov: the box is small, and a
      // copy of it is simpler than many 4-byte patches.
      if (buf.some((v, i) => v !== original[i])) {
        patches.push({ offset: box.start, bytes: buf });
      }
    } else if (box.type === "moof" || box.type === "mfra") {
      // A fragmented file keeps samples (and their metadata tracks) in
      // fragments this does not walk: refused rather than half cleaned.
      throw new VideoMetaError(
        "断片化された MP4 にはまだ対応していません（書き出し直してください）",
      );
    } else if (
      EMPTY_TOP_LEVEL.has(box.type) &&
      box.end - box.body <= MAX_MOOV_BYTES &&
      (await read(box.body, box.end - box.body)).every((v) => v === 0)
    ) {
      // Padding that is already empty (as a copy leaves it): kept.
    } else if (!KEEP_TOP_LEVEL.has(box.type)) {
      // Anything else at the top level (XMP in a uuid, metadata, a free
      // box with leftovers, a vendor's box): blanked without reading.
      patches.push(...stripPatches(box));
    }
    offset = box.end;
    if (offset >= size) break;
  }
  if (!sawMoov) {
    throw new VideoMetaError("動画の moov が見つかりません");
  }
  // Whatever follows the last box that parses (a vendor's trailer, such
  // as Samsung's SEF, or a box cut short): zeroed.
  if (offset < size) {
    if (size - offset > MAX_MOOV_BYTES) {
      throw new VideoMetaError("動画の末尾に読めないデータが多すぎます");
    }
    patches.push({ offset, bytes: new Uint8Array(size - offset) });
  }
  // The samples of the tracks that were taken out (walkTrak), zeroed:
  // their ranges merged first (chunks may share bytes).
  const ranges = found.tracks
    .flatMap((t) => t.dataRanges)
    .sort((a, b) => a.offset - b.offset);
  const merged: { offset: number; end: number }[] = [];
  for (const r of ranges) {
    if (r.offset + r.size > size) {
      throw new VideoMetaError("動画ファイルが途中で切れています");
    }
    const last = merged[merged.length - 1];
    if (last && r.offset <= last.end) {
      last.end = Math.max(last.end, r.offset + r.size);
    } else merged.push({ offset: r.offset, end: r.offset + r.size });
  }
  let cleared = 0;
  for (const r of merged) {
    // Within moov or the trailer already patched: never both (moov and
    // the trailer hold no samples); refused rather than overlapped.
    cleared += r.end - r.offset;
    if (cleared > MAX_MOOV_BYTES) {
      throw new VideoMetaError("動画のメタデータが大きすぎて消せません");
    }
    patches.push({ offset: r.offset, bytes: new Uint8Array(r.end - r.offset) });
  }

  const video = found.tracks.find((t) => t.video) ?? null;
  let width = video ? video.width || video.sampleWidth : 0;
  let height = video ? video.height || video.sampleHeight : 0;
  if (video?.rotated) [width, height] = [height, width];

  let durationMs: number | null = null;
  const mvhd = found.mvhd;
  if (
    mvhd &&
    mvhd.timescale > 0 &&
    mvhd.duration > 0 &&
    mvhd.duration < 2 ** 52
  ) {
    durationMs = Math.round((mvhd.duration / mvhd.timescale) * 1000);
  } else if (video && video.timescale > 0 && video.duration > 0) {
    durationMs = Math.round((video.duration / video.timescale) * 1000);
  }

  const apple = found.apple;
  const created = apple.get("com.apple.quicktime.creationdate");
  const appleAt = created ? appleDateToIso(created) : null;
  const fileAt = mvhd ? qtTimeToIso(mvhd.created) : null;
  const xyz =
    apple.get("com.apple.quicktime.location.ISO6709") ??
    found.udta.get("\u00a9xyz");

  return {
    container,
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
    durationMs,
    codec: video?.codec ?? null,
    takenAt: appleAt
      ? { at: appleAt, source: "exif" }
      : fileAt
        ? { at: fileAt, source: "file_date" }
        : null,
    location: xyz ? parseIso6709(xyz) : null,
    make: cleanText(
      apple.get("com.apple.quicktime.make") ?? found.udta.get("\u00a9mak"),
    ),
    model: cleanText(
      apple.get("com.apple.quicktime.model") ?? found.udta.get("\u00a9mod"),
    ),
    patches,
  };
};

// --- WebM / Matroska --------------------------------------------------------

const ID = {
  ebml: 0x1a45dfa3,
  docType: 0x4282,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  dateUtc: 0x4461,
  title: 0x7ba9,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  name: 0x536e,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  displayWidth: 0x54b0,
  displayHeight: 0x54ba,
  cluster: 0x1f43b675,
  tags: 0x1254c367,
  tag: 0x7373,
  simpleTag: 0x67c8,
  tagName: 0x45a3,
  tagString: 0x4487,
  attachments: 0x1941a469,
  cues: 0x1c53bb6b,
  segmentFilename: 0x7384,
  prevFilename: 0x3c83ab,
  nextFilename: 0x3e83bb,
  void: 0xec,
} as const;

/**
 * What a Cluster holds (Timestamp, SilentTracks, Position, PrevSize,
 * SimpleBlock, BlockGroup, EncryptedBlock): a cluster of unknown size ends
 * where something else starts.
 */
const CLUSTER_CHILDREN: ReadonlySet<number> = new Set([
  0xe7, 0x5854, 0xa7, 0xab, 0xa3, 0xa0, 0xaf,
]);

/** Children of one unknown-size cluster walked at most (a bound). */
const MAX_CLUSTER_CHILDREN = 1_000_000;

/**
 * Segment children a WebM copy keeps; every other one (Chapters with their
 * titles, Tags and Attachments, a muxer's own) becomes Void.
 */
const KEEP_IN_SEGMENT: ReadonlySet<number> = new Set([
  ID.seekHead,
  ID.info,
  ID.tracks,
  ID.cluster,
  ID.cues,
]);

type Element = {
  id: number;
  start: number;
  /** Payload offset. */
  body: number;
  /** End, or null when the size is unknown. */
  end: number | null;
};

/** An EBML element header in buf at o, or null. */
const parseHeader = (buf: Uint8Array, o: number, base = 0): Element | null => {
  if (o >= buf.length) return null;
  const first = buf[o];
  let idLen = 1;
  while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++;
  if (idLen > 4 || o + idLen >= buf.length) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[o + i];
  const s = o + idLen;
  const sFirst = buf[s];
  let sLen = 1;
  while (sLen <= 8 && !(sFirst & (0x80 >> (sLen - 1)))) sLen++;
  if (sLen > 8 || s + sLen > buf.length) return null;
  let value = sFirst & (0xff >> sLen);
  let allOnes = value === 0xff >> sLen;
  for (let i = 1; i < sLen; i++) {
    value = value * 256 + buf[s + i];
    if (buf[s + i] !== 0xff) allOnes = false;
  }
  const body = base + s + sLen;
  return {
    id,
    start: base + o,
    body,
    end: allOnes ? null : body + value,
  };
};

const uintOf = (b: Uint8Array): number => {
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v;
};

const floatOf = (b: Uint8Array): number | null => {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length === 4) return view.getFloat32(0);
  if (b.length === 8) return view.getFloat64(0);
  return null;
};

/** The children of an element held in `buf` (whose file offset is base). */
const ebmlChildren = (
  buf: Uint8Array,
  from: number,
  to: number,
  base: number,
): Element[] => {
  const out: Element[] = [];
  let o = from;
  while (o < to && out.length < MAX_TOP_LEVEL) {
    const e = parseHeader(buf.subarray(0, to), o, 0);
    if (!e || e.end === null || e.end > to) break;
    out.push({
      id: e.id,
      start: base + e.start,
      body: base + e.body,
      end: base + e.end,
    });
    o = e.end;
  }
  return out;
};

/** A Void element exactly `length` bytes long (length >= 2). */
export const voidElement = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  out[0] = ID.void;
  if (length - 2 <= 126) {
    out[1] = 0x80 | (length - 2);
  } else {
    // An 8-byte size vint: 0x01 then 7 bytes of the value.
    let v = length - 9;
    for (let i = 8; i >= 2; i--) {
      out[i] = v % 256;
      v = Math.floor(v / 256);
    }
    out[1] = 0x01;
  }
  return out;
};

const readWebm = async (size: number, read: ReadAt): Promise<VideoMeta> => {
  const header = async (offset: number): Promise<Element | null> => {
    if (offset >= size) return null;
    const h = await read(offset, Math.min(12, size - offset));
    return parseHeader(h, 0, offset);
  };
  const whole = async (e: Element): Promise<Uint8Array> => {
    if (e.end === null || e.end > size) {
      throw new VideoMetaError("動画ファイルが途中で切れています");
    }
    if (e.end - e.start > MAX_EBML_ELEMENT_BYTES) {
      throw new VideoMetaError("動画のメタデータが大きすぎて読めません");
    }
    const buf = await read(e.start, e.end - e.start);
    if (buf.length < e.end - e.start) {
      throw new VideoMetaError("動画ファイルが途中で切れています");
    }
    return buf;
  };

  const ebml = await header(0);
  if (!ebml || ebml.id !== ID.ebml || ebml.end === null) {
    throw new VideoMetaError("WebM のヘッダーが読めません");
  }
  const ebmlBuf = await whole(ebml);
  const docType = ebmlChildren(
    ebmlBuf,
    ebml.body - ebml.start,
    ebmlBuf.length,
    ebml.start,
  ).find((c) => c.id === ID.docType);
  const doc = docType
    ? latin1(
        ebmlBuf,
        docType.body - ebml.start,
        docType.end! - ebml.start,
      ).replace(/\0+$/, "")
    : "";
  if (doc !== "webm" && doc !== "matroska") {
    throw new VideoMetaError("WebM ではありません");
  }
  const segment = await header(ebml.end);
  if (!segment || segment.id !== ID.segment) {
    throw new VideoMetaError("WebM の Segment が見つかりません");
  }
  const segEnd = segment.end === null ? size : Math.min(segment.end, size);

  const patches: BytePatch[] = [];
  const voidOut = (e: Element) =>
    patches.push({ offset: e.start, bytes: voidElement(e.end! - e.start) });

  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let codec: string | null = null;
  let takenAt: VideoMeta["takenAt"] = null;
  /** SimpleTag values by upper-case name (first one wins). */
  const tags = new Map<string, string>();
  /** Elements to read, from the SeekHead (file offsets). */
  const seekTargets = new Map<number, number[]>();
  const done = new Set<number>();

  const handle = async (e: Element) => {
    if (done.has(e.start)) return;
    done.add(e.start);
    if (e.id === ID.seekHead) {
      const buf = await whole(e);
      for (const seek of ebmlChildren(
        buf,
        e.body - e.start,
        buf.length,
        e.start,
      )) {
        if (seek.id !== ID.seek) continue;
        let target = 0;
        let pos = -1;
        for (const c of ebmlChildren(
          buf,
          seek.body - e.start,
          seek.end! - e.start,
          e.start,
        )) {
          const v = buf.subarray(c.body - e.start, c.end! - e.start);
          if (c.id === ID.seekId) target = uintOf(v);
          if (c.id === ID.seekPosition) pos = uintOf(v);
        }
        if (pos >= 0) {
          const list = seekTargets.get(target) ?? [];
          list.push(segment.body + pos);
          seekTargets.set(target, list);
        }
      }
    } else if (e.id === ID.info) {
      const buf = await whole(e);
      let scale = 1_000_000;
      let duration: number | null = null;
      for (const c of ebmlChildren(
        buf,
        e.body - e.start,
        buf.length,
        e.start,
      )) {
        const v = buf.subarray(c.body - e.start, c.end! - e.start);
        if (c.id === ID.timecodeScale) scale = uintOf(v) || scale;
        else if (c.id === ID.duration) duration = floatOf(v);
        else if (c.id === ID.dateUtc && v.length === 8) {
          const ns = new DataView(v.buffer, v.byteOffset, 8).getBigInt64(0);
          const ms = 978_307_200_000 + Number(ns / 1_000_000n);
          if (ns !== 0n && ms > 631_152_000_000) {
            takenAt = { at: jstIso(ms), source: "file_date" };
          }
          voidOut(c);
        } else if (
          c.id === ID.title ||
          c.id === ID.muxingApp ||
          c.id === ID.writingApp ||
          c.id === ID.dateUtc ||
          c.id === ID.segmentFilename ||
          c.id === ID.prevFilename ||
          c.id === ID.nextFilename
        ) {
          voidOut(c);
        }
      }
      if (duration !== null && Number.isFinite(duration) && duration > 0) {
        durationMs = Math.round((duration * scale) / 1_000_000);
      }
    } else if (e.id === ID.tracks) {
      const buf = await whole(e);
      for (const entry of ebmlChildren(
        buf,
        e.body - e.start,
        buf.length,
        e.start,
      )) {
        if (entry.id !== ID.trackEntry) continue;
        let type = 0;
        let id = "";
        let w = 0;
        let h = 0;
        let dw = 0;
        let dh = 0;
        for (const c of ebmlChildren(
          buf,
          entry.body - e.start,
          entry.end! - e.start,
          e.start,
        )) {
          const v = buf.subarray(c.body - e.start, c.end! - e.start);
          if (c.id === ID.trackType) type = uintOf(v);
          else if (c.id === ID.codecId) id = latin1(v, 0, v.length);
          else if (c.id === ID.name) voidOut(c);
          else if (c.id === ID.video) {
            for (const p of ebmlChildren(
              buf,
              c.body - e.start,
              c.end! - e.start,
              e.start,
            )) {
              const pv = uintOf(
                buf.subarray(p.body - e.start, p.end! - e.start),
              );
              if (p.id === ID.pixelWidth) w = pv;
              else if (p.id === ID.pixelHeight) h = pv;
              else if (p.id === ID.displayWidth) dw = pv;
              else if (p.id === ID.displayHeight) dh = pv;
            }
          }
        }
        // A subtitle or metadata track keeps its text in the clusters,
        // where the copy does not reach: refused rather than leaked.
        if (type !== 1 && type !== 2) {
          throw new VideoMetaError(
            "映像と音声以外のトラックがある WebM にはまだ対応していません",
          );
        }
        if (type === 1 && codec === null) {
          codec =
            { V_VP8: "vp8", V_VP9: "vp9", V_AV1: "av1" }[
              id.replace(/\0+$/, "")
            ] ??
            (id.replace(/\0+$/, "") || null);
          width = dw || w || null;
          height = dh || h || null;
        }
      }
    } else if (e.id === ID.tags || e.id === ID.attachments) {
      if (e.end === null || e.end > size) {
        throw new VideoMetaError("動画ファイルが途中で切れています");
      }
      // Tags may say where and with what (read when not huge); either
      // way they do not reach the copy.
      if (e.id === ID.tags && e.end - e.start <= MAX_EBML_ELEMENT_BYTES) {
        const buf = await whole(e);
        readTags(buf, e.body - e.start, buf.length, e.start, tags);
      }
      voidOut(e);
    }
  };

  // Every Segment child is looked at, after the clusters too: a muxer may
  // put Tags, Attachments or its own elements there without listing them
  // in the SeekHead. A sized cluster is stepped over by its header; one of
  // unknown size (a browser's MediaRecorder writes those) by its own
  // children's headers, up to the next element that is not one of them.
  // Only headers are read, never the media.
  let offset = segment.body;
  let n = 0;
  for (; n < MAX_TOP_LEVEL && offset < segEnd; n++) {
    const e = await header(offset);
    if (!e) break;
    if (e.id === ID.cluster) {
      if (e.end === null) {
        let o = e.body;
        for (let k = 0; o < segEnd; k++) {
          if (k >= MAX_CLUSTER_CHILDREN) {
            throw new VideoMetaError("この WebM は構造が大きすぎて確かめられません");
          }
          const c = await header(o);
          if (!c || !CLUSTER_CHILDREN.has(c.id)) break;
          if (c.end === null) {
            throw new VideoMetaError("この WebM の構造には対応していません");
          }
          o = c.end;
        }
        offset = o;
        continue;
      }
    } else if (e.id === ID.void) {
      // Padding (or what a copy blanked already): nothing in it.
    } else if (
      !KEEP_IN_SEGMENT.has(e.id) &&
      e.id !== ID.tags &&
      e.id !== ID.attachments
    ) {
      if (e.end === null || e.end > size) {
        throw new VideoMetaError("動画ファイルが途中で切れています");
      }
      done.add(e.start);
      voidOut(e);
    } else {
      await handle(e);
    }
    if (e.end === null) break;
    offset = e.end;
  }
  if (n >= MAX_TOP_LEVEL && offset < segEnd) {
    throw new VideoMetaError("この WebM は構造が大きすぎて確かめられません");
  }
  // What the SeekHead points at beyond where the walk stopped.
  for (const id of [ID.info, ID.tracks, ID.tags, ID.attachments, ID.seekHead]) {
    for (const pos of seekTargets.get(id) ?? []) {
      if (done.has(pos)) continue;
      const e = await header(pos);
      if (e && e.id === id) await handle(e);
    }
  }
  // A second SeekHead may have added more targets.
  for (const id of [ID.tags, ID.attachments]) {
    for (const pos of seekTargets.get(id) ?? []) {
      if (done.has(pos)) continue;
      const e = await header(pos);
      if (e && e.id === id) await handle(e);
    }
  }

  patches.sort((a, b) => a.offset - b.offset);
  const tagLocation =
    tags.get("COM.APPLE.QUICKTIME.LOCATION.ISO6709") ??
    tags.get("LOCATION") ??
    null;
  return {
    container: "webm",
    width,
    height,
    durationMs,
    codec,
    takenAt,
    location: tagLocation ? parseIso6709(tagLocation) : null,
    make: cleanText(
      tags.get("COM.APPLE.QUICKTIME.MAKE") ?? tags.get("MAKE") ?? null,
    ),
    model: cleanText(
      tags.get("COM.APPLE.QUICKTIME.MODEL") ?? tags.get("MODEL") ?? null,
    ),
    patches,
  };
};

/** Every SimpleTag's TagName → TagString under Tags (Tag, nested SimpleTags). */
const readTags = (
  buf: Uint8Array,
  from: number,
  to: number,
  base: number,
  into: Map<string, string>,
  depth = 0,
) => {
  if (depth > 8) return;
  for (const c of ebmlChildren(buf, from, to, base)) {
    const s = c.body - base;
    const t = c.end! - base;
    if (c.id === ID.tag) readTags(buf, s, t, base, into, depth + 1);
    else if (c.id === ID.simpleTag) {
      let name = "";
      let value: string | null = null;
      for (const d of ebmlChildren(buf, s, t, base)) {
        const v = buf.subarray(d.body - base, d.end! - base);
        if (d.id === ID.tagName) name = utf8(v).toUpperCase();
        else if (d.id === ID.tagString) value = utf8(v);
      }
      if (name && value !== null && !into.has(name)) into.set(name, value);
      readTags(buf, s, t, base, into, depth + 1);
    }
  }
};
