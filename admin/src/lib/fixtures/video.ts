// Synthetic video files for video-meta.spec.ts: only the container
// structure (no decodable frames), written box by box / element by
// element so each test can say exactly what is in the file. Deterministic:
// no clock, no randomness. The real, playable clips for E2E are made by
// ffmpeg (e2e/fixtures/make-video-fixtures.sh).

const enc = new TextEncoder();

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const be = (value: number, bytes: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
};

/** A four-character code; "©" is the byte 0xA9 as in QuickTime. */
const fourcc = (type: string): Uint8Array =>
  Uint8Array.from(type, (c) => c.charCodeAt(0) & 0xff);

const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(...payload);
  return concat(be(8 + body.length, 4), fourcc(type), body);
};

const fullBox = (
  type: string,
  version: number,
  ...payload: Uint8Array[]
): Uint8Array => box(type, Uint8Array.of(version, 0, 0, 0), ...payload);

const zeros = (n: number) => new Uint8Array(n);

export type Mp4Options = {
  brand?: "isom" | "qt  ";
  width?: number;
  height?: number;
  /** Movie timescale and duration (mvhd). */
  timescale?: number;
  duration?: number;
  /** 64-bit mvhd / tkhd / mdhd. */
  version1?: boolean;
  /** Seconds since 1904-01-01 UTC (mvhd, tkhd, mdhd). */
  creationTime?: number;
  codec?: "avc1" | "hvc1";
  /** avcC profile, compatibility, level. */
  avc?: [number, number, number];
  /** QuickTime user data text in moov/udta. */
  udta?: { xyz?: string; make?: string; model?: string };
  /** Apple's mdta keys in moov/meta (QuickTime style, no version/flags). */
  appleMeta?: {
    creationdate?: string;
    location?: string;
    make?: string;
    model?: string;
  };
  /** A top-level uuid box (XMP) with this text. */
  xmp?: string;
  moovAfterMdat?: boolean;
  /** Write mdat with a 64-bit size. */
  largeMdat?: boolean;
  mdat?: Uint8Array;
  /** A 90° rotation matrix in tkhd. */
  rotate90?: boolean;
  /**
   * A timed-metadata track (handler `meta`, like GoPro's GPMF or Google's
   * camm) whose two samples (this text, split in two) are in mdat, after
   * the payload. The movie then comes after mdat.
   */
  gpsTrack?: string;
  /** A top-level box of this type, with `text` (a vendor's, or padding). */
  vendorBox?: { type: string; text: string };
  /**
   * A sound track (no samples) whose mp4a sample entry carries this text
   * where a visual entry has its compressor name (its codec settings).
   */
  audioEntryText?: string;
};

export type BuiltVideo = {
  bytes: Uint8Array;
  /** Where mdat's payload is in `bytes`. */
  mdat: { start: number; end: number };
};

const MATRIX_0 = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
const MATRIX_90 = [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000];

const matrix = (m: number[]) =>
  concat(...m.map((v) => be(v < 0 ? v + 2 ** 32 : v, 4)));

/** udta text: 16-bit length, language, text. */
const udtaText = (type: string, text: string) => {
  const t = enc.encode(text);
  return box(type, be(t.length, 2), be(0x55c4, 2), t);
};

const appleMetaBox = (entries: [string, string][]): Uint8Array => {
  const hdlr = fullBox(
    "hdlr",
    0,
    zeros(4),
    fourcc("mdta"),
    zeros(12),
    Uint8Array.of(0),
  );
  const keys = fullBox(
    "keys",
    0,
    be(entries.length, 4),
    ...entries.map(([k]) => box("mdta", enc.encode(k))),
  );
  const ilst = box(
    "ilst",
    ...entries.map(([, v], i) => {
      // The item's type is its 1-based key index.
      const data = box("data", be(1, 4), zeros(4), enc.encode(v));
      return concat(be(8 + data.length, 4), be(i + 1, 4), data);
    }),
  );
  // QuickTime's meta: no version/flags.
  return box("meta", hdlr, keys, ilst);
};

export const buildMp4 = (o: Mp4Options = {}): BuiltVideo => {
  const width = o.width ?? 1920;
  const height = o.height ?? 1080;
  const timescale = o.timescale ?? 1000;
  const duration = o.duration ?? 2500;
  const v1 = o.version1 ?? false;
  const created = o.creationTime ?? 0;
  const times = v1
    ? concat(be(created, 8), be(created, 8))
    : concat(be(created, 4), be(created, 4));

  const mvhd = fullBox(
    "mvhd",
    v1 ? 1 : 0,
    times,
    be(timescale, 4),
    be(duration, v1 ? 8 : 4),
    be(0x10000, 4),
    be(0x100, 2),
    zeros(10),
    matrix(MATRIX_0),
    zeros(24),
    be(2, 4),
  );
  const tkhd = fullBox(
    "tkhd",
    v1 ? 1 : 0,
    times,
    be(1, 4),
    zeros(4),
    be(duration, v1 ? 8 : 4),
    zeros(8),
    zeros(8),
    matrix(o.rotate90 ? MATRIX_90 : MATRIX_0),
    be(width * 65536, 4),
    be(height * 65536, 4),
  );
  const mdhd = fullBox(
    "mdhd",
    v1 ? 1 : 0,
    times,
    be(90000, 4),
    be(duration * 90, v1 ? 8 : 4),
    be(0x55c4, 2),
    zeros(2),
  );
  const hdlr = fullBox(
    "hdlr",
    0,
    zeros(4),
    fourcc("vide"),
    zeros(12),
    enc.encode("VideoHandler\0"),
  );
  const codec = o.codec ?? "avc1";
  const [profile, compat, level] = o.avc ?? [0x64, 0x00, 0x28];
  const config =
    codec === "avc1"
      ? box("avcC", Uint8Array.of(1, profile, compat, level, 0xff, 0xe0, 0))
      : box("hvcC", zeros(23));
  const sampleEntry = box(
    codec,
    zeros(6),
    be(1, 2),
    zeros(16),
    be(width, 2),
    be(height, 2),
    be(0x480000, 4),
    be(0x480000, 4),
    zeros(4),
    be(1, 2),
    zeros(32),
    be(0x18, 2),
    be(0xffff, 2),
    config,
  );
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, be(1, 4), sampleEntry),
    fullBox("stts", 0, be(0, 4)),
    fullBox("stsc", 0, be(0, 4)),
    fullBox("stsz", 0, be(0, 4), be(0, 4)),
    fullBox("stco", 0, be(0, 4)),
  );
  const minf = box("minf", fullBox("vmhd", 0, zeros(8)), stbl);
  const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, minf));

  const moovParts = [mvhd, trak];
  // The metadata track's samples follow the payload in mdat.
  const basePayload =
    o.mdat ?? enc.encode("MDATPAYLOAD-0123456789-MDATPAYLOAD-END");
  const gps = o.gpsTrack ? enc.encode(o.gpsTrack) : null;
  if (gps) {
    const half = Math.floor(gps.length / 2);
    const ftypLength = 24;
    const xmpLength = o.xmp ? 8 + 16 + enc.encode(o.xmp).length : 0;
    const vendorLength = o.vendorBox
      ? 8 + enc.encode(o.vendorBox.text).length
      : 0;
    const first =
      ftypLength +
      xmpLength +
      vendorLength +
      (o.largeMdat ? 16 : 8) +
      basePayload.length;
    const metaStbl = box(
      "stbl",
      fullBox("stsd", 0, be(1, 4), box("mebx", zeros(8))),
      fullBox("stts", 0, be(0, 4)),
      // Two chunks of one sample each.
      fullBox("stsc", 0, be(1, 4), be(1, 4), be(1, 4), be(1, 4)),
      fullBox(
        "stsz",
        0,
        be(0, 4),
        be(2, 4),
        be(half, 4),
        be(gps.length - half, 4),
      ),
      fullBox("stco", 0, be(2, 4), be(first, 4), be(first + half, 4)),
    );
    moovParts.push(
      box(
        "trak",
        tkhd,
        box(
          "mdia",
          mdhd,
          fullBox(
            "hdlr",
            0,
            zeros(4),
            fourcc("meta"),
            zeros(12),
            Uint8Array.of(0),
          ),
          box("minf", fullBox("nmhd", 0), metaStbl),
        ),
      ),
    );
  }
  if (o.audioEntryText) {
    const entry = zeros(80);
    entry.set(enc.encode(o.audioEntryText).subarray(0, 32), 42);
    moovParts.push(
      box(
        "trak",
        tkhd,
        box(
          "mdia",
          mdhd,
          fullBox(
            "hdlr",
            0,
            zeros(4),
            fourcc("soun"),
            zeros(12),
            Uint8Array.of(0),
          ),
          box(
            "minf",
            fullBox("smhd", 0, zeros(4)),
            box(
              "stbl",
              fullBox("stsd", 0, be(1, 4), box("mp4a", entry)),
              fullBox("stts", 0, be(0, 4)),
              fullBox("stsc", 0, be(0, 4)),
              fullBox("stsz", 0, be(0, 4), be(0, 4)),
              fullBox("stco", 0, be(0, 4)),
            ),
          ),
        ),
      ),
    );
  }
  if (o.udta) {
    const items: Uint8Array[] = [];
    if (o.udta.xyz) items.push(udtaText("©xyz", o.udta.xyz));
    if (o.udta.make) items.push(udtaText("©mak", o.udta.make));
    if (o.udta.model) items.push(udtaText("©mod", o.udta.model));
    moovParts.push(box("udta", ...items));
  }
  if (o.appleMeta) {
    const a = o.appleMeta;
    const entries: [string, string][] = [];
    if (a.creationdate) {
      entries.push(["com.apple.quicktime.creationdate", a.creationdate]);
    }
    if (a.location) {
      entries.push(["com.apple.quicktime.location.ISO6709", a.location]);
    }
    if (a.make) entries.push(["com.apple.quicktime.make", a.make]);
    if (a.model) entries.push(["com.apple.quicktime.model", a.model]);
    moovParts.push(appleMetaBox(entries));
  }
  const moov = box("moov", ...moovParts);

  const brand = o.brand ?? "isom";
  const ftyp = box(
    "ftyp",
    fourcc(brand),
    be(0x200, 4),
    fourcc(brand),
    fourcc(brand === "qt  " ? "qt  " : "mp41"),
  );
  const payload = gps ? concat(basePayload, gps) : basePayload;
  const mdat = o.largeMdat
    ? concat(be(1, 4), fourcc("mdat"), be(16 + payload.length, 8), payload)
    : box("mdat", payload);
  const mdatHeader = o.largeMdat ? 16 : 8;
  const xmp = o.xmp
    ? box(
        "uuid",
        // The XMP uuid (BE7ACFCB-97A9-42E8-9C71-999491E3AFAC).
        Uint8Array.of(
          0xbe,
          0x7a,
          0xcf,
          0xcb,
          0x97,
          0xa9,
          0x42,
          0xe8,
          0x9c,
          0x71,
          0x99,
          0x94,
          0x91,
          0xe3,
          0xaf,
          0xac,
        ),
        enc.encode(o.xmp),
      )
    : new Uint8Array();

  const vendor = o.vendorBox
    ? box(o.vendorBox.type, enc.encode(o.vendorBox.text))
    : new Uint8Array();
  const order =
    o.moovAfterMdat || gps
      ? [ftyp, xmp, vendor, mdat, moov]
      : [ftyp, moov, xmp, vendor, mdat];
  const bytes = concat(...order);
  let start = 0;
  for (const part of order) {
    if (part === mdat) break;
    start += part.length;
  }
  start += mdatHeader;
  return { bytes, mdat: { start, end: start + basePayload.length } };
};

export const buildMov = (o: Mp4Options = {}): BuiltVideo =>
  buildMp4({ ...o, brand: "qt  " });

// --- WebM -------------------------------------------------------------------

const idBytes = (id: number): Uint8Array => {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  return Uint8Array.from(out);
};

const sizeVint = (n: number): Uint8Array => {
  let len = 1;
  while (n >= 2 ** (7 * len) - 1) len++;
  const out = be(n, len);
  out[0] |= 0x80 >> (len - 1);
  return out;
};

const el = (id: number, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(...payload);
  return concat(idBytes(id), sizeVint(body.length), body);
};

const float64 = (v: number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, v);
  return out;
};

export type WebmOptions = {
  width?: number;
  height?: number;
  durationMs?: number;
  /** Nanoseconds since 2001-01-01 UTC. */
  dateUtcNs?: bigint;
  title?: string;
  muxingApp?: string;
  trackName?: string;
  /** A LOCATION SimpleTag (ISO 6709) in Tags after the cluster. */
  tagLocation?: string;
  /** Write a SeekHead that points at Info, Tracks and Tags. */
  seekHead?: boolean;
  /** A Chapters element (before the cluster) with this chapter title. */
  chapterTitle?: string;
  /** A second track: a subtitle track (type 17). */
  subtitleTrack?: boolean;
  /**
   * An Attachments element after the cluster that the SeekHead does not
   * list, with a file of this name.
   */
  trailingAttachment?: string;
  /** Write the cluster with an unknown size (as MediaRecorder does). */
  unknownSizeCluster?: boolean;
};

export const buildWebm = (o: WebmOptions = {}): BuiltVideo => {
  const ebml = el(
    0x1a45dfa3,
    el(0x4286, Uint8Array.of(1)),
    el(0x4282, enc.encode("webm")),
    el(0x4287, Uint8Array.of(4)),
  );
  const infoParts = [
    el(0x2ad7b1, be(1_000_000, 3)),
    el(0x4489, float64(o.durationMs ?? 2500)),
  ];
  if (o.dateUtcNs !== undefined) {
    const d = new Uint8Array(8);
    new DataView(d.buffer).setBigInt64(0, o.dateUtcNs);
    infoParts.push(el(0x4461, d));
  }
  if (o.title) infoParts.push(el(0x7ba9, enc.encode(o.title)));
  infoParts.push(el(0x4d80, enc.encode(o.muxingApp ?? "TestMux")));
  infoParts.push(el(0x5741, enc.encode("TestWriter")));
  const info = el(0x1549a966, ...infoParts);
  const track = el(
    0xae,
    el(0xd7, Uint8Array.of(1)),
    el(0x83, Uint8Array.of(1)),
    el(0x86, enc.encode("V_VP9")),
    ...(o.trackName ? [el(0x536e, enc.encode(o.trackName))] : []),
    el(0xe0, el(0xb0, be(o.width ?? 640, 2)), el(0xba, be(o.height ?? 360, 2))),
  );
  const tracks = el(
    0x1654ae6b,
    track,
    ...(o.subtitleTrack
      ? [
          el(
            0xae,
            el(0xd7, Uint8Array.of(2)),
            el(0x83, Uint8Array.of(17)),
            el(0x86, enc.encode("S_TEXT/UTF8")),
          ),
        ]
      : []),
  );
  const chapters = o.chapterTitle
    ? el(
        0x1043a770,
        el(0x45b9, el(0xb6, el(0x80, el(0x85, enc.encode(o.chapterTitle))))),
      )
    : new Uint8Array();
  const payload = enc.encode("CLUSTERPAYLOAD-0123456789");
  const cluster = o.unknownSizeCluster
    ? concat(
        idBytes(0x1f43b675),
        Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
        el(0xe7, Uint8Array.of(0)),
        el(0xa3, payload),
      )
    : el(0x1f43b675, el(0xe7, Uint8Array.of(0)), el(0xa3, payload));
  const tags = o.tagLocation
    ? el(
        0x1254c367,
        el(
          0x7373,
          el(0x63c0, el(0x68ca, Uint8Array.of(50))),
          el(
            0x67c8,
            el(0x45a3, enc.encode("LOCATION")),
            el(0x4487, enc.encode(o.tagLocation)),
          ),
        ),
      )
    : new Uint8Array();

  const attachment = o.trailingAttachment
    ? el(
        0x1941a469,
        el(0x61a7, el(0x466e, enc.encode(o.trailingAttachment))),
      )
    : new Uint8Array();
  const body = [info, tracks, chapters, cluster, tags, attachment];
  let seekHead: Uint8Array = new Uint8Array();
  if (o.seekHead ?? true) {
    const entry = (id: number, pos: number) =>
      el(0x4dbb, el(0x53ab, idBytes(id)), el(0x53ac, be(pos, 8)));
    const ids = [0x1549a966, 0x1654ae6b, ...(tags.length ? [0x1254c367] : [])];
    const layout = (head: number) => {
      const positions: number[] = [];
      let p = head;
      for (const part of body) {
        positions.push(p);
        p += part.length;
      }
      return positions;
    };
    // Positions are 8 bytes wide, so the SeekHead's length does not
    // depend on them.
    const probe = el(0x114d9b74, ...ids.map((id) => entry(id, 0)));
    const pos = layout(probe.length);
    seekHead = el(
      0x114d9b74,
      entry(0x1549a966, pos[0]),
      entry(0x1654ae6b, pos[1]),
      ...(tags.length ? [entry(0x1254c367, pos[4])] : []),
    );
  }
  const segmentHeader = concat(
    idBytes(0x18538067),
    Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
  );
  const bytes = concat(ebml, segmentHeader, seekHead, ...body);
  const start = indexOf(bytes, payload);
  return { bytes, mdat: { start, end: start + payload.length } };
};

const indexOf = (hay: Uint8Array, needle: Uint8Array, from = 0): number => {
  outer: for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
};

/** Whether `text` (ASCII/UTF-8) occurs anywhere in `bytes`. */
export const contains = (bytes: Uint8Array, text: string): boolean =>
  indexOf(bytes, enc.encode(text)) >= 0;
