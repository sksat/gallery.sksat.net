import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatExposure,
  isScanner,
  MAX_PLAYERS,
  needsTail,
  normalizeHints,
  normalizeStoredMeta,
  photographerFromXmp,
  readPhotoMeta,
  readPhotoMetaSync,
  readVrcxJson,
  worldFromXmp,
  xmpDateToIso,
  xmpTakenAt,
} from "./photo-meta";
import { pickTakenAt } from "./taken-at";

// Tiny synthetic images written by Pillow (fixtures/make-fixtures.py), not
// by this parser's own writer: an 8x8 JPEG with EXIF and GPS, and 8x8
// PNGs with a VRChat-style XMP iTXt chunk (plain and compressed).
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const WORLD = {
  id: "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
  name: "The Black Cat & Friends",
};

describe("readPhotoMeta", () => {
  it("reads a JPEG's EXIF and GPS", async () => {
    const meta = await readPhotoMeta(fixture("exif-gps.jpg"));
    expect(meta.exif).toEqual({
      make: "FUJIFILM",
      model: "X-T5",
      lens: "XF35mmF1.4 R",
      focal_length_mm: 35,
      f_number: 2.8,
      exposure_time: "1/250",
      iso: 400,
      orientation: 6,
      taken_at_original: "2023-12-11T01:21:32+09:00",
    });
    expect(meta.takenAt).toBe("2023-12-11T01:21:32+09:00");
    // 35°39'31.35"N 139°44'40.92"E
    expect(meta.location?.latitude).toBeCloseTo(35.658708, 5);
    expect(meta.location?.longitude).toBeCloseTo(139.7447, 4);
    expect(meta.world).toBeNull();
  });

  it("reads VRChat's world from a PNG's XMP, plain or compressed", async () => {
    for (const name of ["vrchat-xmp.png", "vrchat-xmp-z.png"]) {
      const meta = await readPhotoMeta(fixture(name));
      expect(meta.world).toEqual(WORLD);
      // vrc:AuthorID is who took it (no xmp:Author name in this one).
      expect(meta.photographer).toEqual({
        id: "usr_00000000-1111-2222-3333-444444444444",
        name: null,
      });
      expect(meta.vrcx).toBeNull();
      expect(meta.exif).toBeNull();
      expect(meta.location).toBeNull();
      expect(meta.creatorTool).toBe("VRChat");
    }
    expect(
      (await readPhotoMeta(fixture("exif-gps.jpg"))).creatorTool,
    ).toBeNull();
  });

  it("keeps only well-formed hints from a request", () => {
    expect(normalizeHints({ creatorTool: " VRChat " })).toEqual({
      creatorTool: "VRChat",
    });
    expect(normalizeHints({ creatorTool: 1 })).toEqual({ creatorTool: null });
    expect(normalizeHints(null)).toEqual({ creatorTool: null });
  });

  it("finds XMP after the image data in the file's last bytes", async () => {
    const png = fixture("vrchat-xmp.png");
    // Pillow writes iTXt before IDAT; move it to the end, as some writers do.
    const view = new DataView(png.buffer, png.byteOffset);
    const chunks: Uint8Array[] = [];
    let itxt: Uint8Array | null = null;
    for (let p = 8; p < png.length;) {
      const len = view.getUint32(p);
      const chunk = png.subarray(p, p + 12 + len);
      const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
      if (type === "iTXt") itxt = chunk;
      else chunks.push(chunk);
      p += 12 + len;
    }
    const iend = chunks.pop()!;
    const moved = new Uint8Array(png.length);
    let o = 0;
    for (const c of [png.subarray(0, 8), ...chunks, itxt!, iend]) {
      moved.set(c, o);
      o += c.length;
    }
    // The whole file: the walk reaches it.
    expect((await readPhotoMeta(moved)).world).toEqual(WORLD);
    // Only a head that stops inside IDAT, and the tail.
    const head = moved.subarray(0, 60);
    expect((await readPhotoMeta(head)).world).toBeNull();
    // The tail: a few bytes of IDAT, then the iTXt chunk and IEND.
    const tail = moved.subarray(moved.length - itxt!.length - 12 - 5);
    expect((await readPhotoMeta(head, tail)).world).toEqual(WORLD);
  });

  it("returns what it can from truncated or foreign bytes", async () => {
    const jpeg = fixture("exif-gps.jpg");
    expect((await readPhotoMeta(jpeg.subarray(0, 30))).exif).toBeNull();
    expect(await readPhotoMeta(new TextEncoder().encode("hello"))).toEqual({
      takenAt: null,
      dates: { exifOriginal: null, xmp: null, exifDateTime: null },
      exif: null,
      fileExif: null,
      digitizedAt: null,
      location: null,
      world: null,
      creatorTool: null,
      photographer: null,
      vrcx: null,
    });
    expect(readPhotoMetaSync(new Uint8Array(0)).exif).toBeNull();
    // Every prefix parses without throwing.
    for (let n = 0; n < jpeg.length; n += 7) {
      readPhotoMetaSync(jpeg.subarray(0, n));
    }
  });
});

describe("hostile and unusual EXIF", () => {
  /** A big- or little-endian TIFF with a GPS IFD of the given entries. */
  const gpsTiff = (little: boolean, ref: string | null, cut?: number) => {
    const b = new Uint8Array(200);
    const v = new DataView(b.buffer);
    v.setUint16(0, little ? 0x4949 : 0x4d4d);
    v.setUint16(2, 42, little);
    v.setUint32(4, 8, little);
    // IFD0: Make "Ab" (inline) and the GPS pointer.
    v.setUint16(8, 2, little);
    const entry = (at: number, tag: number, type: number, n: number) => {
      v.setUint16(at, tag, little);
      v.setUint16(at + 2, type, little);
      v.setUint32(at + 4, n, little);
    };
    entry(10, 0x010f, 2, 3);
    b.set([0x41, 0x62, 0], 18);
    entry(22, 0x8825, 13, 1); // type IFD
    v.setUint32(30, 40, little);
    // GPS IFD at 40: (ref), latitude (3 rationals at 100).
    const n = ref === null ? 1 : 2;
    v.setUint16(40, n, little);
    let e = 42;
    if (ref !== null) {
      entry(e, 1, 2, 2);
      b.set([ref.charCodeAt(0), 0], e + 8);
      e += 12;
    }
    entry(e, 2, 5, 3);
    v.setUint32(e + 8, 100, little);
    [10, 1, 30, 1, 0, 1].forEach((x, i) => v.setUint32(100 + i * 4, x, little));
    // Longitude reuses the latitude's values (E).
    const app1 = (t: Uint8Array) => {
      const len = 2 + 6 + t.length;
      return Uint8Array.from([
        0xff,
        0xd8,
        0xff,
        0xe1,
        len >> 8,
        len & 0xff,
        0x45,
        0x78,
        0x69,
        0x66,
        0,
        0,
        ...t,
      ]);
    };
    return app1(cut === undefined ? b : b.subarray(0, cut));
  };

  it("needs the N/S ref for a position, in either byte order", () => {
    for (const little of [true, false]) {
      expect(readPhotoMetaSync(gpsTiff(little, "S")).exif).toEqual({
        make: "Ab",
      });
      // No longitude: no position.
      expect(readPhotoMetaSync(gpsTiff(little, "S")).location).toBeNull();
      expect(readPhotoMetaSync(gpsTiff(little, null)).location).toBeNull();
    }
  });

  it("keeps the entries read before a cut", () => {
    // IFD0 says two entries, the bytes stop after the first.
    expect(readPhotoMetaSync(gpsTiff(true, "N", 22)).exif).toEqual({
      make: "Ab",
    });
  });

  it("survives crafted PNG chunks", async () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, data: number[], len = data.length) => [
      len >>> 24,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
      ...Array.from(type, (c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0,
    ];
    const kw = Array.from("XML:com.adobe.xmp", (c) => c.charCodeAt(0));
    for (const png of [
      // A length far past the end.
      [...sig, ...chunk("iTXt", [1, 2, 3], 0x7fffffff)],
      // iTXt without its NULs.
      [...sig, ...chunk("iTXt", kw)],
      // Compressed, but not zlib.
      [...sig, ...chunk("iTXt", [...kw, 0, 1, 0, 0, 0, 1, 2, 3, 4])],
    ]) {
      expect((await readPhotoMeta(Uint8Array.from(png))).world).toBeNull();
    }
  });

  it("reads XMP from a JPEG", async () => {
    const xmp = new TextEncoder().encode(
      `http://ns.adobe.com/xap/1.0/\0<x vrc:WorldID="wrld_j" vrc:WorldDisplayName='Bob&apos;s "Room"'/>`,
    );
    const len = 2 + xmp.length;
    const jpeg = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe1,
      len >> 8,
      len & 0xff,
      ...xmp,
      0xff,
      0xda,
    ]);
    expect((await readPhotoMeta(jpeg)).world).toEqual({
      id: "wrld_j",
      name: `Bob's "Room"`,
    });
  });
});

describe("dates", () => {
  it("takes VRChat's XMP CreateDate, to the millisecond with its offset", async () => {
    const meta = await readPhotoMeta(fixture("vrchat-2026.png"));
    expect(meta.dates).toEqual({
      exifOriginal: null,
      xmp: "2026-11-02T11:31:36.959+09:00",
      exifDateTime: null,
    });
    expect(meta.takenAt).toBe("2026-11-02T11:31:36.959+09:00");
    expect(meta.world).toEqual({
      id: "wrld_00000000-aaaa-bbbb-cccc-000000000001",
      name: "桜の川 （Sakura）",
    });
    expect(meta.photographer).toEqual({
      id: "usr_00000000-1111-2222-3333-555555555555",
      name: "Someone",
    });
  });

  it("keeps a scanner's EXIF and date apart from the shooting info", async () => {
    const meta = await readPhotoMeta(fixture("lab-scan.jpg"));
    expect(meta.exif).toBeNull();
    expect(meta.fileExif).toMatchObject({
      make: "FUJI PHOTO FILM CO., LTD.",
      model: "SP-2000",
      taken_at_original: "2023-12-12T10:00:00",
      date_time: "2023-12-12T10:00:00+09:00",
    });
    expect(meta.digitizedAt).toBe("2023-12-12T10:00:00+09:00");
    expect(meta.dates).toEqual({
      exifOriginal: null,
      xmp: null,
      exifDateTime: null,
    });
    expect(meta.takenAt).toBeNull();
  });

  it("never takes a date from a GCMC Scanner's unset clock", async () => {
    const meta = await readPhotoMeta(fixture("gcmc-scan.jpg"));
    expect(meta.exif).toBeNull();
    expect(meta.fileExif).toMatchObject({
      make: "GCMC",
      model: "Scanner",
      taken_at_original: "2021-01-01T00:31:12",
    });
    expect(meta.digitizedAt).toBe("2021-01-01T00:31:12+09:00");
    expect(meta.dates).toEqual({
      exifOriginal: null,
      xmp: null,
      exifDateTime: null,
    });
    expect(meta.takenAt).toBeNull();
    // Nor from a name in the folder that is no VRChat file name.
    expect(pickTakenAt(meta.dates, "IMG_0001.jpg")).toBeNull();
  });

  it("knows the common film scanners", () => {
    for (const [make, model] of [
      ["GCMC", "Scanner"],
      ["Canon", "CanoScan 9000F Scanner"],
      ["FUJI PHOTO FILM CO., LTD.", "SP-3000"],
      ["FUJIFILM", "Frontier LP5000"],
      ["NORITSU KOKI", "QSS-32"],
      ["Eastman Kodak Company", "Pakon F-135"],
      ["Nikon", "LS-5000"],
      ["EPSON", "Perfection V600"],
    ]) {
      expect(isScanner(make, model), `${make} ${model}`).toBe(true);
    }
    for (const [make, model] of [
      ["FUJIFILM", "X-T5"],
      ["NIKON CORPORATION", "NIKON Z 6"],
      [undefined, undefined],
    ]) {
      expect(isScanner(make, model), `${make} ${model}`).toBe(false);
    }
  });

  it("reads XMP dates in their forms", () => {
    expect(xmpDateToIso("2026-11-02T11:31:36.9591864+09:00")).toBe(
      "2026-11-02T11:31:36.959+09:00",
    );
    expect(xmpDateToIso("2026-11-02T11:31:36Z")).toBe(
      "2026-11-02T11:31:36+00:00",
    );
    expect(xmpDateToIso("2026-11-02T11:31")).toBe("2026-11-02T11:31:00+09:00");
    expect(xmpDateToIso("2026-11-02")).toBeNull();
    expect(xmpDateToIso("2026-02-30T00:00:00Z")).toBeNull();
    // An attribute, and the EXIF date in XMP as a fallback.
    expect(
      xmpTakenAt(`<d exif:DateTimeOriginal="2020-01-02T03:04:05-05:00"/>`),
    ).toBe("2020-01-02T03:04:05-05:00");
  });
});

describe("worldFromXmp", () => {
  it("keeps apostrophes, CDATA and attributes on the element", () => {
    expect(
      worldFromXmp(
        `<r vrc:WorldID="wrld_a" vrc:WorldDisplayName="Bob's Room"/>`,
      ),
    ).toEqual({ id: "wrld_a", name: "Bob's Room" });
    expect(
      worldFromXmp(
        `<vrc:WorldDisplayName xml:lang="ja"><![CDATA[A & B]]></vrc:WorldDisplayName>`,
      )?.name,
    ).toBe("A & B");
  });

  it("reads attributes as well as elements", () => {
    expect(
      worldFromXmp(
        `<rdf:Description vrc:WorldID="wrld_abc-1" vrc:WorldDisplayName="A &lt;B&gt; &#x1F431;"/>`,
      ),
    ).toEqual({ id: "wrld_abc-1", name: "A <B> 🐱" });
  });

  it("drops ids that are not VRChat ids", () => {
    expect(
      worldFromXmp(
        "<vrc:WorldID>javascript:x</vrc:WorldID><vrc:AuthorID>x</vrc:AuthorID>",
      ),
    ).toBeNull();
    expect(worldFromXmp("<x/>")).toBeNull();
  });
});

describe("photographerFromXmp", () => {
  const ID = "usr_00000000-1111-2222-3333-444444444444";
  it("reads VRChat's AuthorID with the display name in xmp:Author", () => {
    expect(
      photographerFromXmp(
        `<vrc:AuthorID>${ID}</vrc:AuthorID><xmp:Author>Neko &amp; Co</xmp:Author>`,
      ),
    ).toEqual({ id: ID, name: "Neko & Co" });
  });

  it("reads the user id that older VRChat wrote in xmp:Author", () => {
    const TOOL = "<xmp:CreatorTool>VRChat</xmp:CreatorTool>";
    expect(
      photographerFromXmp(`${TOOL}<xmp:Author>${ID}</xmp:Author>`),
    ).toEqual({ id: ID, name: null });
    expect(
      photographerFromXmp(
        `<x xmlns:vrc="http://ns.vrchat.com/vrc/1.0/"><xmp:Author>Neko</xmp:Author></x>`,
      ),
    ).toEqual({ id: null, name: "Neko" });
  });

  it("ignores another tool's xmp:Author", () => {
    expect(
      photographerFromXmp(
        "<xmp:CreatorTool>Lightroom</xmp:CreatorTool><xmp:Author>Me</xmp:Author>",
      ),
    ).toBeNull();
  });

  it("drops an AuthorID that is not a user id, and the name with it", () => {
    expect(
      photographerFromXmp(
        "<vrc:AuthorID>javascript:x</vrc:AuthorID><xmp:Author>N</xmp:Author>",
      ),
    ).toBeNull();
    expect(photographerFromXmp("<x/>")).toBeNull();
  });
});

describe("VRCX", () => {
  const SOMEONE = "usr_00000000-1111-2222-3333-555555555555";
  const SAKURA = {
    id: "wrld_00000000-aaaa-bbbb-cccc-000000000001",
    name: "桜の川 （Sakura）",
  };
  const VRCX = {
    instance_id: `${SAKURA.id}:75296~friends(${SOMEONE})~region(jp)`,
    players: [
      { id: SOMEONE, name: "Someone" },
      { id: "usr_00000000-1111-2222-3333-666666666666", name: "ねこ" },
    ],
  };

  it("reads VRCX's Description next to VRChat's XMP", async () => {
    const meta = await readPhotoMeta(fixture("vrcx.png"));
    expect(meta.world).toEqual(SAKURA);
    expect(meta.photographer).toEqual({ id: SOMEONE, name: "Someone" });
    expect(meta.vrcx).toEqual(VRCX);
    expect(meta.takenAt).toBe("2026-11-02T11:31:36.959+09:00");
  });

  it("takes the world and photographer from VRCX alone (before VRChat's XMP)", async () => {
    for (const name of ["vrcx-only.png", "vrcx-text.png", "vrcx-ztxt.png"]) {
      const meta = await readPhotoMeta(fixture(name));
      expect(meta.world, name).toEqual(SAKURA);
      expect(meta.photographer, name).toEqual({ id: SOMEONE, name: "Someone" });
      expect(meta.vrcx, name).toEqual(VRCX);
    }
    // Uncompressed text needs no inflating.
    expect(readPhotoMetaSync(fixture("vrcx-text.png")).vrcx).toEqual(VRCX);
  });

  it("still reads the tail when the head has a Description but no XMP", () => {
    // VRChat's XMP (and its CreateDate) may be after the image data.
    const cut = (png: Uint8Array) =>
      png.subarray(0, String.fromCharCode(...png).indexOf("IDAT") + 8);
    expect(needsTail(cut(fixture("vrcx-only.png")))).toBe(true);
    expect(needsTail(cut(fixture("vrcx.png")))).toBe(false);
  });

  it("finds a Description after the image data in the last bytes", async () => {
    const png = fixture("vrcx-only.png");
    const view = new DataView(png.buffer, png.byteOffset);
    const chunks: Uint8Array[] = [];
    let text: Uint8Array | null = null;
    for (let p = 8; p < png.length;) {
      const len = view.getUint32(p);
      const chunk = png.subarray(p, p + 12 + len);
      const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
      if (type === "iTXt") text = chunk;
      else chunks.push(chunk);
      p += 12 + len;
    }
    const iend = chunks.pop()!;
    const moved = new Uint8Array(png.length);
    let o = 0;
    for (const c of [png.subarray(0, 8), ...chunks, text!, iend]) {
      moved.set(c, o);
      o += c.length;
    }
    const head = moved.subarray(0, 60);
    expect(needsTail(head)).toBe(true);
    const tail = moved.subarray(moved.length - text!.length - 12 - 5);
    expect((await readPhotoMeta(head, tail)).vrcx).toEqual(VRCX);
  });

  it("ignores malformed JSON and other applications' text", () => {
    expect(readVrcxJson("{not json")).toBeNull();
    expect(readVrcxJson("lfs|2|author:usr_a,A")).toBeNull();
    expect(readVrcxJson('{"application":"Other","world":{}}')).toBeNull();
    expect(readVrcxJson("[1]")).toBeNull();
    expect(readVrcxJson('{"application":"VRCX"}')).toEqual({
      world: null,
      author: null,
      vrcx: null,
    });
  });

  it("keeps only well-formed parts", () => {
    const many = Array.from({ length: MAX_PLAYERS + 5 }, (_, i) => ({
      id: `usr_${i}`,
      displayName: `P${i}`,
    }));
    const r = readVrcxJson(
      JSON.stringify({
        application: "VRCX",
        author: { id: "x", displayName: " Me " },
        world: {
          id: "javascript:x",
          name: "",
          instanceId: "wrld_a:1~private(usr_b)\n<script>",
        },
        players: [null, "x", { id: 5 }, { displayName: "  " }, ...many],
      }),
    );
    expect(r?.world).toBeNull();
    expect(r?.author).toEqual({ id: null, name: "Me" });
    expect(r?.vrcx?.instance_id).toBeNull();
    // The junk counts toward the cap; every kept one is a person.
    expect(r?.vrcx?.players.length).toBe(MAX_PLAYERS - 4);
    expect(r?.vrcx?.players[0]).toEqual({ id: "usr_0", name: "P0" });
    // Each user once.
    expect(
      readVrcxJson(
        JSON.stringify({
          application: "VRCX",
          players: [
            { id: "usr_a", displayName: "A" },
            { id: "usr_a", displayName: "A again" },
          ],
        }),
      )?.vrcx?.players,
    ).toEqual([{ id: "usr_a", name: "A" }]);
    // "private" / "offline" locations have no world: no instance.
    expect(
      readVrcxJson(
        '{"application":"VRCX","world":{"id":"","instanceId":"private"}}',
      )?.vrcx,
    ).toBeNull();
  });

  it("prefers VRChat's photographer, VRCX filling in the same user's name", async () => {
    const ID = "usr_00000000-1111-2222-3333-444444444444";
    const png = (xmp: string, author: object) => {
      const meta = (keyword: string, text: string) => {
        const body = new TextEncoder().encode(`${keyword}\0\0\0\0\0${text}`);
        const len = body.length;
        return [
          len >>> 24,
          (len >> 16) & 0xff,
          (len >> 8) & 0xff,
          len & 0xff,
          ...Array.from("iTXt", (c) => c.charCodeAt(0)),
          ...body,
          0,
          0,
          0,
          0,
        ];
      };
      return Uint8Array.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...meta("XML:com.adobe.xmp", xmp),
        ...meta(
          "Description",
          JSON.stringify({ application: "VRCX", author }),
        ),
      ]);
    };
    const OLD = `<xmp:CreatorTool>VRChat</xmp:CreatorTool><xmp:Author>${ID}</xmp:Author>`;
    // Older XMP: the id alone; VRCX names the same user.
    expect(
      (await readPhotoMeta(png(OLD, { id: ID, displayName: "A" })))
        .photographer,
    ).toEqual({ id: ID, name: "A" });
    // Someone else in VRCX's author: VRChat's is kept as it is.
    expect(
      (
        await readPhotoMeta(
          png(OLD, {
            id: "usr_other",
            displayName: "B",
          }),
        )
      ).photographer,
    ).toEqual({ id: ID, name: null });
  });

  it("takes the photographer and VRCX's extras from an upload request leniently", () => {
    const meta = normalizeStoredMeta({
      photographer: { id: "usr_a", name: "A" },
      vrcx: {
        instance_id: "wrld_a:1",
        players: [{ id: "bad", name: "B" }, 3],
      },
    });
    expect(meta.photographer).toEqual({ id: "usr_a", name: "A" });
    expect(meta.vrcx).toEqual({
      instance_id: "wrld_a:1",
      players: [{ id: null, name: "B" }],
    });
    expect(normalizeStoredMeta({ vrcx: { players: [] } }).vrcx).toBeNull();
  });
});

describe("formatExposure", () => {
  it("writes fractions below a second, seconds above", () => {
    expect(formatExposure(1 / 250)).toBe("1/250");
    expect(formatExposure(1 / 3)).toBe("1/3");
    expect(formatExposure(0.3)).toBe("0.3");
    expect(formatExposure(2)).toBe("2");
    expect(formatExposure(2.5)).toBe("2.5");
    expect(formatExposure(0)).toBeNull();
  });
});

describe("normalizeXmpSummary", () => {
  it("keeps the known parts, in bounds", async () => {
    const { normalizeXmpSummary, MAX_HISTORY } = await import("./photo-meta");
    expect(normalizeXmpSummary(null)).toBeNull();
    expect(
      normalizeXmpSummary({ crs: { Foo: "x" }, crs_count: -1 }),
    ).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => ({
      action: `a${i}`,
      agent: "x".repeat(500),
      extra: 1,
    }));
    const s = normalizeXmpSummary({
      crs: { ProcessVersion: " 15.4 ", Unknown: "1", Exposure2012: 3 },
      crs_count: 120,
      history: [...many, "junk"],
      history_count: 31,
      other: "dropped",
    });
    expect(s?.crs).toEqual({ ProcessVersion: "15.4" });
    expect(s?.crs_count).toBe(120);
    expect(s?.history).toHaveLength(MAX_HISTORY - 1);
    expect(s?.history?.[0]).toEqual({ action: "a21", agent: "x".repeat(64) });
    expect(s?.history_count).toBe(31);
    expect(s).not.toHaveProperty("other");
  });
});
