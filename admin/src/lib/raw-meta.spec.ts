import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  crc32,
  flattenXmp,
  MAX_READ_BYTES,
  MAX_SECTIONS,
  maybeJson,
  readRawMeta,
  readTiff,
  type RangeRead,
  type RawMeta,
} from "./raw-meta";

// Tiny files built here, byte by byte, so every value is known.

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u16be = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const u32be = (n: number) =>
  new Uint8Array([n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

// --- TIFF (little-endian) --------------------------------------------------

type Entry = { tag: number; type: number; count: number; data: Uint8Array };
const le = (n: number, size: number) => {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (n >>> (8 * i)) & 0xff;
  return b;
};
const asciiE = (tag: number, s: string): Entry => {
  const data = cat(enc(s), new Uint8Array([0]));
  return { tag, type: 2, count: data.length, data };
};
const shortE = (tag: number, n: number): Entry => ({
  tag,
  type: 3,
  count: 1,
  data: le(n, 2),
});
const longE = (tag: number, n: number): Entry => ({
  tag,
  type: 4,
  count: 1,
  data: le(n, 4),
});
const ratE = (tag: number, ...r: [number, number][]): Entry => ({
  tag,
  type: 5,
  count: r.length,
  data: cat(...r.flatMap(([a, b]) => [le(a, 4), le(b, 4)])),
});
const undefE = (tag: number, data: Uint8Array): Entry => ({
  tag,
  type: 7,
  count: data.length,
  data,
});

/**
 * IFDs in order; `pointers` names, per IFD, a tag whose LONG value is
 * the offset of another IFD (by index), and `next` links IFD0 to IFD1.
 */
const tiff = (
  ifds: Entry[][],
  pointers: { from: number; tag: number; to: number }[],
  next?: { from: number; to: number },
) => {
  for (const p of pointers) ifds[p.from].push(longE(p.tag, 0));
  for (const ifd of ifds) ifd.sort((a, b) => a.tag - b.tag);
  const sizeOf = (ifd: Entry[]) =>
    2 +
    ifd.length * 12 +
    4 +
    ifd.reduce(
      (n, e) =>
        n + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0),
      0,
    );
  const offsets: number[] = [];
  let o = 8;
  for (const ifd of ifds) {
    offsets.push(o);
    o += sizeOf(ifd);
  }
  for (const p of pointers) {
    ifds[p.from].find((e) => e.tag === p.tag)!.data = le(offsets[p.to], 4);
  }
  const parts: Uint8Array[] = [enc("II"), le(42, 2), le(8, 4)];
  ifds.forEach((ifd, i) => {
    let data = offsets[i] + 2 + ifd.length * 12 + 4;
    const extra: Uint8Array[] = [];
    parts.push(le(ifd.length, 2));
    for (const e of ifd) {
      parts.push(le(e.tag, 2), le(e.type, 2), le(e.count, 4));
      if (e.data.length <= 4) {
        const v = new Uint8Array(4);
        v.set(e.data);
        parts.push(v);
      } else {
        parts.push(le(data, 4));
        extra.push(e.data);
        if (e.data.length % 2) extra.push(new Uint8Array(1));
        data += e.data.length + (e.data.length % 2);
      }
    }
    parts.push(le(next && next.from === i ? offsets[next.to] : 0, 4));
    parts.push(...extra);
  });
  return cat(...parts);
};

const makerNote = new Uint8Array(100).map((_, i) => i);

const exifTiff = () =>
  tiff(
    [
      [asciiE(0x010f, "FUJIFILM"), asciiE(0x0110, "X-T5"), shortE(0x0112, 6)],
      [
        ratE(0x829a, [1, 250]),
        asciiE(0x9003, "2023:12:11 01:21:32"),
        undefE(0x9000, enc("0232")),
        undefE(0x927c, makerNote),
        undefE(0x9286, cat(enc("ASCII\0\0\0"), enc("hello"))),
        shortE(0xbeef, 7),
      ],
      [asciiE(0x0001, "N"), ratE(0x0002, [35, 1], [39, 1], [3135, 100])],
      [asciiE(0x0001, "R98")],
      [shortE(0x0103, 6)],
    ],
    [
      { from: 0, tag: 0x8769, to: 1 },
      { from: 0, tag: 0x8825, to: 2 },
      { from: 1, tag: 0xa005, to: 3 },
    ],
    { from: 0, to: 4 },
  );

// --- ICC ---------------------------------------------------------------------

const icc = () => {
  const desc = cat(enc("desc"), new Uint8Array(4), u32be(5), enc("sRGB\0"));
  const header = new Uint8Array(128);
  header.set(u32be(144 + desc.length), 0);
  header.set(enc("lcms"), 4);
  header.set([2, 0x10], 8);
  header.set(enc("mntrRGB XYZ "), 12);
  header.set([...u16be(2024), ...u16be(1), ...u16be(2)], 24);
  header.set(enc("acspAPPL"), 36);
  return cat(
    header,
    u32be(1),
    enc("desc"),
    u32be(144),
    u32be(desc.length),
    desc,
  );
};

// --- JPEG --------------------------------------------------------------------

const seg = (marker: number, body: Uint8Array) =>
  cat(new Uint8Array([0xff, marker]), u16be(body.length + 2), body);

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="5">' +
  "<xmp:CreatorTool>Tool &amp; Co</xmp:CreatorTool>" +
  "<dc:subject><rdf:Bag><rdf:li>cat</rdf:li><rdf:li>night</rdf:li></rdf:Bag></dc:subject>" +
  "</rdf:Description></rdf:RDF></x:xmpmeta>";

const iptc = () => {
  const ds = (rec: number, n: number, s: string) =>
    cat(new Uint8Array([0x1c, rec, n]), u16be(enc(s).length), enc(s));
  const data = cat(ds(2, 25, "kw1"), ds(2, 25, "kw2"), ds(2, 80, "Someone"));
  return cat(
    enc("Photoshop 3.0\0"),
    enc("8BIM"),
    u16be(0x0404),
    new Uint8Array([0, 0]),
    u32be(data.length),
    data,
    data.length % 2 ? new Uint8Array(1) : new Uint8Array(0),
  );
};

const extXmp = (guid: string, full: string) => {
  const b = enc(full);
  const half = Math.ceil(b.length / 2);
  const part = (off: number, d: Uint8Array) =>
    seg(
      0xe1,
      cat(
        enc("http://ns.adobe.com/xmp/extension/\0"),
        enc(guid),
        u32be(b.length),
        u32be(off),
        d,
      ),
    );
  // Out of order on purpose.
  return cat(part(half, b.subarray(half)), part(0, b.subarray(0, half)));
};

const jpeg = (...extra: Uint8Array[]) =>
  cat(
    new Uint8Array([0xff, 0xd8]),
    seg(
      0xe0,
      cat(enc("JFIF\0"), new Uint8Array([1, 2, 1, 0, 72, 0, 72, 0, 0])),
    ),
    seg(0xe1, cat(enc("Exif\0\0"), exifTiff())),
    seg(0xe1, cat(enc("http://ns.adobe.com/xap/1.0/\0"), enc(XMP))),
    extXmp(
      "0123456789ABCDEF0123456789ABCDEF",
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/" GDepth:Format="RangeInverse"/></rdf:RDF></x:xmpmeta>',
    ),
    seg(0xe2, cat(enc("ICC_PROFILE\0"), new Uint8Array([1, 1]), icc())),
    seg(0xed, iptc()),
    seg(
      0xee,
      cat(enc("Adobe"), u16be(100), u16be(0), u16be(0), new Uint8Array([1])),
    ),
    seg(0xeb, cat(enc("JP\0"), new Uint8Array([9, 9, 9]))),
    seg(0xfe, enc("a comment")),
    ...extra,
    seg(
      0xc0,
      new Uint8Array([8, 0, 6, 0, 8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ),
    seg(0xda, new Uint8Array([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    new Uint8Array([1, 2, 3, 4, 0xff, 0xd9]),
  );

// --- PNG ---------------------------------------------------------------------

const chunk = (type: string, data: Uint8Array) =>
  cat(u32be(data.length), enc(type), data, u32be(crc32(cat(enc(type), data))));

const deflate = async (b: Uint8Array) =>
  new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(b)])
        .stream()
        .pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

const PNG_SIG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const png = async (idat: Uint8Array[]) =>
  cat(
    PNG_SIG,
    chunk("IHDR", cat(u32be(8), u32be(6), new Uint8Array([8, 2, 0, 0, 0]))),
    chunk(
      "tEXt",
      cat(
        enc("Description\0"),
        enc('{"author":{"displayName":"Someone"},"world":{"id":"wrld_x"}}'),
      ),
    ),
    chunk("zTXt", cat(enc("Comment\0\0"), await deflate(enc("zipped words")))),
    chunk("iTXt", cat(enc("XML:com.adobe.xmp\0\0\0\0\0"), enc(XMP))),
    chunk(
      "iTXt",
      cat(enc("Title\0\x01\0ja\0題\0"), await deflate(enc("夜の猫"))),
    ),
    chunk("eXIf", exifTiff()),
    chunk("pHYs", cat(u32be(2835), u32be(2835), new Uint8Array([1]))),
    chunk("tIME", cat(u16be(2024), new Uint8Array([1, 2, 3, 4, 5]))),
    chunk("gAMA", u32be(45455)),
    ...idat.map((d) => chunk("IDAT", d)),
    chunk("tEXt", enc("AfterData\0written last")),
    chunk("vrCd", new Uint8Array([1, 2, 3])),
    chunk("IEND", new Uint8Array(0)),
  );

// --- A fake AdminImage.bytes -------------------------------------------------

const reader = (file: Uint8Array) => {
  const calls: unknown[] = [];
  const read: RangeRead = async (range) => {
    calls.push(range);
    if ("suffix" in range) {
      expect(range.suffix).toBeLessThanOrEqual(MAX_READ_BYTES);
      return {
        bytes: file.slice(Math.max(0, file.length - range.suffix)),
        size: file.length,
      };
    }
    expect(range.length).toBeLessThanOrEqual(MAX_READ_BYTES);
    return {
      bytes: file.slice(range.offset, range.offset + range.length),
      size: file.length,
    };
  };
  return { read, calls };
};

const section = (meta: RawMeta, source: string, name?: string) =>
  meta.sections.find(
    (s) => s.source === source && (name === undefined || s.name === name),
  )?.data as Record<string, unknown>;

describe("readRawMeta: JPEG", () => {
  it("reads every segment before the image data", async () => {
    const meta = (await readRawMeta(reader(jpeg()).read))!;
    expect(meta.format).toBe("jpeg");
    expect(meta.truncated).toBeNull();
    expect(meta.reads).toBe(1);

    const exif = section(meta, "EXIF") as Record<
      string,
      Record<string, unknown>
    >;
    expect(exif.IFD0["Make (0x010f)"]).toBe("FUJIFILM");
    expect(exif.IFD0["Orientation (0x0112)"]).toBe(6);
    expect(exif.Exif["ExposureTime (0x829a)"]).toBe("1/250");
    expect(exif.Exif["ExifVersion (0x9000)"]).toBe("0232");
    expect(exif.Exif["UserComment (0x9286)"]).toBe("hello");
    expect(exif.Exif["MakerNote (0x927c)"]).toMatchObject({
      type: "MakerNote",
      size: 100,
      head: expect.stringMatching(/^00 01 02 03/),
    });
    // An unknown tag still shows, by number.
    expect(exif.Exif["Tag (0xbeef)"]).toBe(7);
    expect(exif.GPS["GPSLatitude (0x0002)"]).toEqual([
      "35/1",
      "39/1",
      "3135/100",
    ]);
    expect(exif.Interop["InteroperabilityIndex (0x0001)"]).toBe("R98");
    expect(exif.IFD1["Compression (0x0103)"]).toBe(6);

    const xmps = meta.sections.filter((s) => s.source === "XMP");
    expect(xmps).toHaveLength(2);
    expect((xmps[0].data as { properties: unknown }).properties).toEqual({
      "xmp:Rating": "5",
      "xmp:CreatorTool": "Tool & Co",
      "dc:subject": ["cat", "night"],
    });
    expect(xmps[1].name).toMatch(/extended/);
    expect((xmps[1].data as { properties: unknown }).properties).toEqual({
      "GDepth:Format": "RangeInverse",
    });

    expect(section(meta, "ICC")).toMatchObject({
      cmm: "lcms",
      version: "2.1.0",
      class: "mntr",
      colorSpace: "RGB",
      created: "2024-01-02T00:00:00",
      tags: { desc: "sRGB" },
    });
    expect(section(meta, "IPTC")).toEqual({
      "Keywords (2:25)": ["kw1", "kw2"],
      "By-line (2:80)": "Someone",
    });
    expect(section(meta, "JFIF")).toMatchObject({
      version: "1.02",
      xDensity: 72,
    });
    expect(section(meta, "Adobe")).toMatchObject({
      version: 100,
      transform: 1,
    });
    expect(meta.sections.find((s) => s.source === "Comment")?.data).toBe(
      "a comment",
    );
    expect(meta.sections.find((s) => s.source === "Other")).toMatchObject({
      name: "APP11 JP",
      data: { size: 6 },
    });
    expect(section(meta, "JPEG", "SOF0")).toMatchObject({
      width: 8,
      height: 6,
      components: 3,
    });
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });

  it("reads on past the first window, and says where it stopped", async () => {
    const big = Array.from({ length: 6 }, (_, i) =>
      seg(0xe5, cat(enc(`Big${i}\0`), new Uint8Array(60_000))),
    );
    const file = jpeg(...big);
    const all = (await readRawMeta(reader(file).read))!;
    expect(all.truncated).toBeNull();
    expect(all.reads).toBe(2);
    expect(section(all, "JPEG", "SOF0")).toBeTruthy();

    const { read, calls } = reader(file);
    const cut = (await readRawMeta(read, 1))!;
    expect(calls).toHaveLength(1);
    expect(cut.truncated).toMatch(/read limit/);
    expect(section(cut, "EXIF")).toBeTruthy();
    expect(section(cut, "JPEG", "SOF0")).toBeUndefined();
  });
});

describe("readRawMeta: PNG", () => {
  it("reads every chunk but the image data, also after it", async () => {
    const meta = (await readRawMeta(
      reader(await png([new Uint8Array(10)])).read,
    ))!;
    expect(meta.format).toBe("png");
    expect(meta.truncated).toBeNull();
    expect(section(meta, "PNG", "IHDR")).toMatchObject({
      width: 8,
      height: 6,
      colorType: "RGB",
    });
    const texts = meta.sections.filter((s) => s.name === "tEXt");
    // JSON in a text chunk is shown as JSON.
    expect(texts[0].data).toEqual({
      keyword: "Description",
      text: { author: { displayName: "Someone" }, world: { id: "wrld_x" } },
    });
    expect(texts[1].data).toEqual({
      keyword: "AfterData",
      text: "written last",
    });
    expect(section(meta, "PNG", "zTXt")).toEqual({
      keyword: "Comment",
      compressed: true,
      text: "zipped words",
    });
    expect(section(meta, "XMP", "iTXt")).toMatchObject({
      properties: { "xmp:CreatorTool": "Tool & Co" },
    });
    expect(section(meta, "PNG", "iTXt")).toEqual({
      keyword: "Title",
      compressed: true,
      language: "ja",
      translatedKeyword: "題",
      text: "夜の猫",
    });
    const exif = section(meta, "EXIF", "eXIf") as Record<
      string,
      Record<string, unknown>
    >;
    expect(exif.IFD0["Model (0x0110)"]).toBe("X-T5");
    expect(section(meta, "PNG", "pHYs")).toEqual({
      x: 2835,
      y: 2835,
      unit: "metre",
    });
    expect(meta.sections.find((s) => s.name === "tIME")?.data).toBe(
      "2024-01-02T03:04:05Z",
    );
    expect(meta.sections.find((s) => s.name === "gAMA")?.data).toBe(0.45455);
    expect(section(meta, "PNG", "IDAT")).toEqual({ chunks: 1, bytes: 10 });
    expect(section(meta, "PNG", "vrCd")).toEqual({ size: 3, head: "01 02 03" });
  });

  it("skips one big IDAT by its length", async () => {
    const { read, calls } = reader(
      await png([new Uint8Array(3 * MAX_READ_BYTES)]),
    );
    const meta = (await readRawMeta(read))!;
    expect(calls).toHaveLength(2);
    expect(meta.truncated).toBeNull();
    expect(meta.sections.some((s) => s.name === "vrCd")).toBe(true);
  });

  it("finds the chunks after many small IDATs from the file's end", async () => {
    const idats = Array.from({ length: 512 }, () => new Uint8Array(8192));
    const { read, calls } = reader(await png(idats));
    const meta = (await readRawMeta(read, 4))!;
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual({ suffix: MAX_READ_BYTES });
    expect(meta.truncated).toBeNull();
    const texts = meta.sections.filter((s) => s.name === "tEXt");
    expect(texts.at(-1)?.data).toEqual({
      keyword: "AfterData",
      text: "written last",
    });
    const idat = section(meta, "PNG", "IDAT") as Record<string, number>;
    expect(idat.chunks).toBeLessThan(512);
    expect(idat.bytes + idat.skipped).toBeGreaterThan(512 * 8192);
  });
});

describe("readRawMeta: others", () => {
  it("is null for a missing file", async () => {
    expect(await readRawMeta(async () => null)).toBeNull();
  });

  it("shows an unknown file by its head", async () => {
    const meta = (await readRawMeta(reader(enc("GIF89a....")).read))!;
    expect(meta.format).toBe("unknown");
    expect(meta.sections[0].data).toMatchObject({
      size: 10,
      head: "47 49 46 38 39 61 2e 2e 2e 2e",
    });
  });

  it("reads a WebP's EXIF and XMP chunks", async () => {
    const riff = (type: string, d: Uint8Array) =>
      cat(
        enc(type),
        le(d.length, 4),
        d,
        d.length % 2 ? new Uint8Array(1) : new Uint8Array(0),
      );
    const body = cat(
      enc("WEBP"),
      riff("VP8X", new Uint8Array([0x0c, 0, 0, 0, 7, 0, 0, 5, 0, 0])),
      riff("VP8L", new Uint8Array([0x2f, 7, 0x40, 1, 0, 0])),
      riff("EXIF", exifTiff()),
      riff("XMP ", enc(XMP)),
    );
    const meta = (await readRawMeta(
      reader(cat(enc("RIFF"), le(body.length, 4), body)).read,
    ))!;
    expect(meta.format).toBe("webp");
    expect(section(meta, "WebP", "VP8X")).toMatchObject({
      width: 8,
      height: 6,
    });
    const exif = section(meta, "EXIF") as Record<
      string,
      Record<string, unknown>
    >;
    expect(exif.IFD0["Make (0x010f)"]).toBe("FUJIFILM");
    expect(section(meta, "XMP")).toMatchObject({
      properties: { "xmp:Rating": "5" },
    });
  });
});

describe("flattenXmp", () => {
  it("keeps nested properties and parses JSON values", () => {
    expect(
      flattenXmp(
        '<rdf:Description><a:B><rdf:Description a:C="1"><a:D>{"x":1}</a:D></rdf:Description></a:B></rdf:Description>',
      ),
    ).toEqual({ "a:B/a:C": "1", "a:B/a:D": { x: 1 } });
  });
});

describe("flattenXmp: attributes", () => {
  it("reads past a > inside a quoted value", () => {
    expect(
      flattenXmp(
        `<rdf:Description dc:title="A > B" xmp:Rating='5'/><a:C>x</a:C>`,
      ),
    ).toEqual({ "dc:title": "A > B", "xmp:Rating": "5", "a:C": "x" });
  });
});

describe("crafted files end quickly, with what was found", () => {
  it("an XMP of unterminated constructs", () => {
    const t = Date.now();
    expect(flattenXmp("<?".repeat(300_000))).toEqual({});
    expect(flattenXmp(`<a:B>x</a:B>${"<!--".repeat(300_000)}`)).toEqual({
      "a:B": "x",
    });
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("deeply nested JSON stays text", () => {
    const deep = "[".repeat(10_000) + "]".repeat(10_000);
    expect(maybeJson(deep)).toBe(deep);
    expect(maybeJson('{"a":[1,{"b":"[[["}]}')).toEqual({
      a: [1, { b: "[[[" }],
    });
  });

  it("EXIF IFDs pointing at each other", () => {
    // The Exif IFD points to itself and to IFD0.
    const t = tiff(
      [[asciiE(0x010f, "Make")], [shortE(0x8827, 100)]],
      [
        { from: 0, tag: 0x8769, to: 1 },
        { from: 1, tag: 0x8769, to: 1 },
        { from: 1, tag: 0xa005, to: 0 },
      ],
      { from: 0, to: 0 },
    );
    const out = readTiff(t) as Record<string, Record<string, unknown>>;
    expect(out.IFD0["Make (0x010f)"]).toBe("Make");
    expect(out.Exif["ISOSpeedRatings (0x8827)"]).toBe(100);
  });

  it("thousands of empty segments", async () => {
    const coms = Array.from({ length: 2000 }, () =>
      seg(0xfe, new Uint8Array(0)),
    );
    const meta = (await readRawMeta(reader(jpeg(...coms)).read))!;
    expect(meta.truncated).toMatch(/more than/);
    expect(meta.sections.length).toBeLessThanOrEqual(MAX_SECTIONS + 10);
    expect(section(meta, "EXIF")).toBeTruthy();
  });

  it("a file shorter than it said keeps what was read", async () => {
    const file = jpeg(seg(0xe5, new Uint8Array(60_000)));
    const meta = (await readRawMeta(async (range) => {
      if ("suffix" in range || range.offset > 0) {
        return { bytes: new Uint8Array(0), size: file.length + 300_000 };
      }
      return {
        bytes: file.slice(0, 1000),
        size: file.length + 300_000,
      };
    }))!;
    expect(meta.truncated).toMatch(/shorter/);
  });

  it("bytes after IEND do not stop the tail from being found", async () => {
    const idats = Array.from({ length: 512 }, () => new Uint8Array(8192));
    const file = cat(await png(idats), enc("trailing junk"));
    const meta = (await readRawMeta(reader(file).read, 4))!;
    expect(meta.truncated).toBeNull();
    expect(meta.sections.some((s) => s.name === "vrCd")).toBe(true);
  });

  it("a big chunk does not use the read kept for the end", async () => {
    const idats = Array.from({ length: 512 }, () => new Uint8Array(8192));
    const big = chunk("zzBg", new Uint8Array(900_000));
    const p = await png(idats);
    // The big chunk right after IHDR, before the text chunks.
    const file = cat(p.subarray(0, 33), big, p.subarray(33));
    const meta = (await readRawMeta(reader(file).read, 4))!;
    expect(section(meta, "PNG", "zzBg")).toMatchObject({ size: 900_000 });
    expect(meta.sections.some((s) => s.name === "vrCd")).toBe(true);
  });
});

describe("readRawMeta: the Pillow fixtures", () => {
  const fixture = (name: string) =>
    new Uint8Array(
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url)),
    );

  it("reads a JPEG's EXIF and GPS", async () => {
    const meta = (await readRawMeta(reader(fixture("exif-gps.jpg")).read))!;
    const exif = section(meta, "EXIF") as Record<
      string,
      Record<string, unknown>
    >;
    expect(exif.IFD0["Make (0x010f)"]).toBe("FUJIFILM");
    expect(exif.Exif["LensModel (0xa434)"]).toBe("XF35mmF1.4 R");
    expect(exif.GPS["GPSLongitudeRef (0x0003)"]).toBe("E");
  });

  it("reads VRChat's XMP in a PNG", async () => {
    const meta = (await readRawMeta(reader(fixture("vrchat-2026.png")).read))!;
    expect(section(meta, "XMP")).toMatchObject({
      properties: {
        "vrc:WorldDisplayName": "桜の川 （Sakura）",
        "xmp:CreateDate": "2026-11-02T11:31:36.9591864+09:00",
      },
    });
  });
});
