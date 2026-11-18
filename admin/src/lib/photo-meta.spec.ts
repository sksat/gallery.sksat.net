import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatExposure,
  readPhotoMeta,
  readPhotoMetaSync,
  worldFromXmp,
} from "./photo-meta";

// Tiny synthetic images written by Pillow (fixtures/make-fixtures.py), not
// by this parser's own writer: an 8x8 JPEG with EXIF and GPS, and 8x8
// PNGs with a VRChat-style XMP iTXt chunk (plain and compressed).
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const WORLD = {
  id: "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
  name: "The Black Cat & Friends",
  authorId: "usr_00000000-1111-2222-3333-444444444444",
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
      expect(meta.exif).toBeNull();
      expect(meta.location).toBeNull();
    }
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
      exif: null,
      location: null,
      world: null,
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
      authorId: null,
    });
  });
});

describe("worldFromXmp", () => {
  it("keeps apostrophes, CDATA and attributes on the element", () => {
    expect(
      worldFromXmp(
        `<r vrc:WorldID="wrld_a" vrc:WorldDisplayName="Bob's Room"/>`,
      ),
    ).toEqual({ id: "wrld_a", name: "Bob's Room", authorId: null });
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
    ).toEqual({ id: "wrld_abc-1", name: "A <B> 🐱", authorId: null });
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
