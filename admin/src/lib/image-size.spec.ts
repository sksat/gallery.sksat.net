import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displaySize, imageSize } from "./image-size";

describe("displaySize", () => {
  const size = { width: 4000, height: 3000 };
  it("swaps width and height for orientations 5–8 (a quarter turn)", () => {
    for (const o of [5, 6, 7, 8]) {
      expect(displaySize(size, o), String(o)).toEqual({
        width: 3000,
        height: 4000,
      });
    }
  });
  it("keeps them for the other orientations and when there is none", () => {
    for (const o of [1, 2, 3, 4, 0, 9, null, undefined]) {
      expect(displaySize(size, o), String(o)).toEqual(size);
    }
  });
});

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** A PNG's signature and IHDR chunk (no image data). */
const pngHeader = (width: number, height: number) =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    ...ascii("IHDR"),
    ...u32(width),
    ...u32(height),
    8, // bit depth
    2, // RGB
    0,
    0,
    0,
    ...u32(0), // CRC (not checked)
  ]);

/** A JPEG up to its frame header: SOI, an APP1, a DQT, then `sof`. */
const jpegHeader = (sof: number, width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    // APP1 with 6 bytes of payload.
    0xff,
    0xe1,
    ...u16(8),
    ...ascii("Exif"),
    0,
    0,
    // A fill byte before the next marker.
    0xff,
    // DQT (65 bytes of payload, contents irrelevant).
    0xff,
    0xdb,
    ...u16(67),
    ...new Array<number>(65).fill(1),
    0xff,
    sof,
    ...u16(17),
    8,
    ...u16(height),
    ...u16(width),
    3,
    ...new Array<number>(9).fill(0),
  ]);

describe("imageSize", () => {
  it("reads a PNG's IHDR", () => {
    expect(imageSize(pngHeader(3840, 2160))).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(imageSize(pngHeader(13000, 9000))).toEqual({
      width: 13000,
      height: 9000,
    });
    expect(imageSize(fixture("vrchat-xmp.png"))).toEqual({
      width: 8,
      height: 8,
    });
  });

  it("reads a JPEG's frame header, baseline or progressive", () => {
    expect(imageSize(jpegHeader(0xc0, 6000, 4000))).toEqual({
      width: 6000,
      height: 4000,
    });
    expect(imageSize(jpegHeader(0xc2, 640, 480))).toEqual({
      width: 640,
      height: 480,
    });
    expect(imageSize(fixture("exif-gps.jpg"))).toEqual({
      width: 8,
      height: 8,
    });
  });

  it("skips segments that are not frame headers (DHT, DAC)", () => {
    const b = jpegHeader(0xc4, 1, 1);
    // A DHT (C4) where the SOF would be: the walk goes on past it and
    // ends with the bytes, so no size.
    expect(imageSize(b)).toBeNull();
  });

  it("is null for cut-off or other bytes", () => {
    const png = pngHeader(100, 100);
    expect(imageSize(png.subarray(0, 23))).toBeNull();
    const jpeg = jpegHeader(0xc0, 100, 100);
    // Cut inside the SOF before the width.
    expect(imageSize(jpeg.subarray(0, jpeg.length - 12))).toBeNull();
    // Cut inside the DQT.
    expect(imageSize(jpeg.subarray(0, 30))).toBeNull();
    // The E2E's fake PNGs: a signature and filler, no IHDR.
    expect(
      imageSize(
        new Uint8Array([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
          ...new Array(64).fill(0x61),
        ]),
      ),
    ).toBeNull();
    expect(imageSize(new Uint8Array(ascii("GIF89a...........")))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
  });

  it("is null for a zero size (a JPEG with its height in a DNL)", () => {
    expect(imageSize(jpegHeader(0xc0, 100, 0))).toBeNull();
    expect(imageSize(pngHeader(0, 100))).toBeNull();
  });

  it("is null for a broken segment chain", () => {
    // A byte that is not a marker between segments.
    const junk = jpegHeader(0xc0, 100, 100);
    junk[12] = 0x00; // where the DQT marker's 0xff was
    expect(imageSize(junk)).toBeNull();
    // A segment length that runs past the end.
    expect(
      imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xf0, 0, 0])),
    ).toBeNull();
  });

  it("stops at the start of scan", () => {
    const b = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xda,
      ...u16(8),
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(imageSize(b)).toBeNull();
  });
});
