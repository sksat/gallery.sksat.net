/**
 * Putting an EXIF block into a finished image without decoding it (tested
 * with Vitest): only the container is edited, the compressed image data is
 * copied as is, so it costs a copy of the bytes and nothing more (a Worker
 * on the Free plan has 10 ms of CPU).
 *
 * - JPEG: an APP1 "Exif" segment right after SOI (after the JFIF APP0 when
 *   there is one).
 * - WebP: the extended format. A simple file (one VP8 or VP8L chunk) gets a
 *   VP8X header with the canvas size read from that chunk's frame header;
 *   an extended one gets the EXIF flag set. The EXIF chunk goes after the
 *   image data (before XMP), where the spec puts it.
 * - Anything else (AVIF) is returned unchanged: the Worker asks for WebP
 *   or JPEG instead when it has EXIF to add (request.ts).
 */

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));

/** The TIFF block as a JPEG APP1 segment. Null if it does not fit (64 KB). */
const app1 = (tiff: Uint8Array): Uint8Array | null => {
  const len = 2 + 6 + tiff.length;
  if (len > 0xffff) return null;
  const seg = new Uint8Array(2 + len);
  seg.set([0xff, 0xe1, len >> 8, len & 0xff]);
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  seg.set(tiff, 10);
  return seg;
};

/** A JPEG with `tiff` as its EXIF; null when it is not a JPEG. */
export const embedJpeg = (
  jpeg: Uint8Array,
  tiff: Uint8Array,
): Uint8Array | null => {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  const seg = app1(tiff);
  if (!seg) return null;
  let at = 2;
  // Keep the APP0 segments (JFIF, then any JFXX) first, as JFIF requires.
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) {
    at += 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
    if (at > jpeg.length) return null;
  }
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, at));
  out.set(seg, at);
  out.set(jpeg.subarray(at), at + seg.length);
  return out;
};

type Chunk = { fourcc: string; start: number; end: number };

/** RIFF chunks of a WebP after "WEBP" (start/end include header and pad). */
const webpChunks = (b: Uint8Array): Chunk[] | null => {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") {
    return null;
  }
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = Math.min(b.length, 8 + d.getUint32(4, true));
  const chunks: Chunk[] = [];
  for (let p = 12; p + 8 <= riffEnd;) {
    const size = d.getUint32(p + 4, true);
    if (p + 8 + size > riffEnd) return null;
    // The pad byte of an odd-sized chunk (missing on the last one at times).
    const end = Math.min(p + 8 + size + (size & 1), riffEnd);
    chunks.push({ fourcc: ascii(b, p, 4), start: p, end });
    p = end;
  }
  return chunks.length > 0 ? chunks : null;
};

const VP8X_EXIF = 0x08;
const VP8X_ALPHA = 0x10;

/** Canvas size and alpha of a simple WebP's image chunk, or null. */
const simpleCanvas = (
  b: Uint8Array,
  c: Chunk,
): { width: number; height: number; alpha: boolean } | null => {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const data = c.start + 8;
  if (c.fourcc === "VP8 " && c.end - data >= 10) {
    // Frame tag (3 bytes), start code 9d 01 2a, then 14-bit sizes.
    if (b[data + 3] !== 0x9d || b[data + 4] !== 0x01 || b[data + 5] !== 0x2a) {
      return null;
    }
    return {
      width: d.getUint16(data + 6, true) & 0x3fff,
      height: d.getUint16(data + 8, true) & 0x3fff,
      alpha: false,
    };
  }
  if (c.fourcc === "VP8L" && c.end - data >= 5 && b[data] === 0x2f) {
    const bits = d.getUint32(data + 1, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    };
  }
  return null;
};

const chunk = (fourcc: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(8 + data.length + (data.length & 1));
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** A WebP with `tiff` as its EXIF; null when it cannot be done. */
export const embedWebp = (
  webp: Uint8Array,
  tiff: Uint8Array,
): Uint8Array | null => {
  const chunks = webpChunks(webp);
  if (!chunks) return null;
  // A chunk as stored, padded to an even length if its pad was missing.
  const body = (c: Chunk) =>
    (c.end - c.start) & 1
      ? concat([webp.subarray(c.start, c.end), new Uint8Array(1)])
      : webp.subarray(c.start, c.end);
  const exif = chunk("EXIF", tiff);
  let parts: Uint8Array[];
  if (chunks[0].fourcc === "VP8X") {
    const x = chunks[0];
    if (x.end - x.start < 18) return null;
    const header = body(x).slice();
    header[8] |= VP8X_EXIF;
    const rest = chunks.slice(1).filter((c) => c.fourcc !== "EXIF");
    const xmp = rest.findIndex((c) => c.fourcc === "XMP ");
    const before = xmp < 0 ? rest : rest.slice(0, xmp);
    const after = xmp < 0 ? [] : rest.slice(xmp);
    parts = [header, ...before.map(body), exif, ...after.map(body)];
  } else {
    if (chunks.length !== 1) return null;
    const canvas = simpleCanvas(webp, chunks[0]);
    if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
    const x = new Uint8Array(10);
    x[0] = VP8X_EXIF | (canvas.alpha ? VP8X_ALPHA : 0);
    const w = canvas.width - 1;
    const h = canvas.height - 1;
    x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 4);
    x.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 7);
    parts = [chunk("VP8X", x), body(chunks[0]), exif];
  }
  const payload = concat(parts);
  const out = new Uint8Array(12 + payload.length);
  out.set(webp.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + payload.length, true);
  out.set(payload, 12);
  return out;
};

/**
 * The image with `tiff` as its EXIF, by its content type; the image as it
 * was when the format has no support here or the edit fails.
 */
export const embedExif = (
  image: Uint8Array,
  contentType: string | null,
  tiff: Uint8Array,
): { bytes: Uint8Array; embedded: boolean } => {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const out =
    type === "image/jpeg"
      ? embedJpeg(image, tiff)
      : type === "image/webp"
        ? embedWebp(image, tiff)
        : null;
  return out
    ? { bytes: out, embedded: true }
    : { bytes: image, embedded: false };
};
