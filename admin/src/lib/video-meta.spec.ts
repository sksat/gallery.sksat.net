import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMov,
  buildMp4,
  buildWebm,
  contains,
  type BuiltVideo,
} from "./fixtures/video";
import {
  appleDateToIso,
  applyPatches,
  parseIso6709,
  qtTimeToIso,
  readVideoMeta,
  videoContainerOf,
  voidElement,
  type ReadAt,
} from "./video-meta";

const reader =
  (bytes: Uint8Array, log?: [number, number][]): ReadAt =>
  async (offset, length) => {
    log?.push([offset, offset + length]);
    return bytes.slice(offset, offset + length);
  };

const read = (bytes: Uint8Array) => readVideoMeta(bytes.length, reader(bytes));

/** The playback copy, and what reading it finds. */
const neutralise = async (bytes: Uint8Array) => {
  const meta = await read(bytes);
  if (!meta) throw new Error("not a video");
  const copy = applyPatches(bytes, meta.patches);
  return { meta, copy, again: await read(copy) };
};

// 2026-11-18T01:02:03Z in QuickTime seconds (since 1904).
const QT_2026 = Date.UTC(2026, 10, 18, 1, 2, 3) / 1000 + 2_082_844_800;

const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/;

describe("readVideoMeta: MP4 / MOV", () => {
  it("leaves a sound track's sample entry alone (its codec settings)", async () => {
    const built = buildMp4({ audioEntryText: "AUDIOCONFIG-KEEP" });
    const { copy } = await neutralise(built.bytes);
    expect(contains(copy, "AUDIOCONFIG-KEEP")).toBe(true);
  });

  it("reads size, duration, an H.264 codec string and the mvhd time", async () => {
    const { bytes } = buildMp4({ creationTime: QT_2026 });
    const meta = await read(bytes);
    expect(meta).toMatchObject({
      container: "mp4",
      width: 1920,
      height: 1080,
      durationMs: 2500,
      codec: "avc1.640028",
      takenAt: { at: "2026-11-18T10:02:03+09:00", source: "file_date" },
      location: null,
      make: null,
      model: null,
    });
    expect(meta!.takenAt!.at).toMatch(ISO_RE);
  });

  it("tells MOV from its ftyp brand", async () => {
    const meta = await read(buildMov({ codec: "hvc1" }).bytes);
    expect(meta?.container).toBe("mov");
    expect(meta?.codec).toBe("hvc1");
  });

  it("prefers Apple's creationdate with its offset, and reads its keys", async () => {
    const { bytes } = buildMov({
      creationTime: QT_2026,
      appleMeta: {
        creationdate: "2026-11-18T10:20:30+0900",
        location: "+35.6895+139.6917+040.000/",
        make: "Apple",
        model: "iPhone 15 Pro",
      },
    });
    const meta = await read(bytes);
    expect(meta).toMatchObject({
      takenAt: { at: "2026-11-18T10:20:30+09:00", source: "exif" },
      location: { latitude: 35.6895, longitude: 139.6917 },
      make: "Apple",
      model: "iPhone 15 Pro",
    });
  });

  it("reads QuickTime user data (©xyz, ©mak, ©mod)", async () => {
    const meta = await read(
      buildMp4({
        udta: { xyz: "-33.8688+151.2093/", make: "Sony", model: "ILCE-7M4" },
      }).bytes,
    );
    expect(meta).toMatchObject({
      location: { latitude: -33.8688, longitude: 151.2093 },
      make: "Sony",
      model: "ILCE-7M4",
      takenAt: null,
    });
  });

  it("reads moov after mdat, 64-bit boxes and a rotated track", async () => {
    const meta = await read(
      buildMp4({
        moovAfterMdat: true,
        largeMdat: true,
        version1: true,
        creationTime: QT_2026,
        timescale: 600,
        duration: 600 * 75,
        rotate90: true,
      }).bytes,
    );
    expect(meta).toMatchObject({
      width: 1080,
      height: 1920,
      durationMs: 75_000,
      takenAt: { at: "2026-11-18T10:02:03+09:00" },
    });
  });

  it("never reads the media data", async () => {
    for (const built of [
      buildMp4({ moovAfterMdat: true }),
      buildMp4({ largeMdat: true, xmp: "<x/>" }),
    ]) {
      const log: [number, number][] = [];
      await readVideoMeta(built.bytes.length, reader(built.bytes, log));
      for (const [s, e] of log) {
        expect(e <= built.mdat.start || s >= built.mdat.end).toBe(true);
      }
    }
  });
});

describe("the playback copy: MP4 / MOV", () => {
  const leaky = (o: Parameters<typeof buildMp4>[0] = {}): BuiltVideo =>
    buildMov({
      creationTime: QT_2026,
      udta: { xyz: "+35.1234+139.5678/", make: "UdtaMake", model: "UdtaModel" },
      appleMeta: {
        creationdate: "2026-11-18T10:20:30+0900",
        location: "+35.6895+139.6917+040.000/",
        make: "AppleMake",
        model: "AppleModel",
      },
      xmp: '<rdf:Description exif:GPSLatitude="35,41.37N"/>',
      ...o,
    });

  it("keeps the size and the media data, and drops place, device and time", async () => {
    for (const built of [
      leaky(),
      leaky({ moovAfterMdat: true, version1: true }),
    ]) {
      const { meta, copy, again } = await neutralise(built.bytes);
      expect(meta.location).not.toBeNull();
      expect(copy.length).toBe(built.bytes.length);
      expect(copy.subarray(built.mdat.start, built.mdat.end)).toEqual(
        built.bytes.subarray(built.mdat.start, built.mdat.end),
      );
      expect(again).toMatchObject({
        container: "mov",
        width: 1920,
        height: 1080,
        durationMs: 2500,
        codec: "avc1.640028",
        takenAt: null,
        location: null,
        make: null,
        model: null,
        patches: [],
      });
      // Gone from the bytes, not just from what players read.
      for (const s of [
        "+35.1234",
        "+35.6895",
        "UdtaMake",
        "AppleModel",
        "GPSLatitude",
        "com.apple.quicktime",
        "udta",
        "uuid",
      ]) {
        expect(contains(built.bytes, s)).toBe(true);
        expect(contains(copy, s)).toBe(false);
      }
    }
  });

  it("patches only moov and the top-level metadata boxes", async () => {
    const built = leaky();
    const { meta } = await neutralise(built.bytes);
    const moovAt = built.bytes.findIndex(
      (_, i) =>
        String.fromCharCode(...built.bytes.subarray(i + 4, i + 8)) === "moov",
    );
    for (const p of meta.patches) {
      const end = p.offset + p.bytes.length;
      expect(end <= built.mdat.start - 8 || p.offset >= built.mdat.end).toBe(
        true,
      );
      // ftyp stays.
      expect(p.offset).toBeGreaterThanOrEqual(moovAt);
    }
  });

  it("changes a clean file only in its handler's name, once", async () => {
    const built = buildMp4();
    const { copy, again } = await neutralise(built.bytes);
    expect(contains(built.bytes, "VideoHandler")).toBe(true);
    expect(contains(copy, "VideoHandler")).toBe(false);
    expect(again?.patches).toEqual([]);
  });

  it("zeroes a trailer after the last box, and vendor boxes in the movie", async () => {
    const built = buildMp4();
    const withTrailer = new Uint8Array(built.bytes.length + 16);
    withTrailer.set(built.bytes);
    withTrailer.set(
      new TextEncoder().encode("SEFTGPS+35.68"),
      built.bytes.length,
    );
    const { copy } = await neutralise(withTrailer);
    expect(copy.length).toBe(withTrailer.length);
    expect(contains(copy, "SEFT")).toBe(false);
  });

  it("zeroes a timed-metadata track's samples and drops the track", async () => {
    const built = buildMp4({ gpsTrack: "GPSFIX+35.6895+139.6917GPSEND" });
    const { meta, copy, again } = await neutralise(built.bytes);
    expect(copy.length).toBe(built.bytes.length);
    // The picture's own data stays, the metadata samples are zeros.
    expect(copy.subarray(built.mdat.start, built.mdat.end)).toEqual(
      built.bytes.subarray(built.mdat.start, built.mdat.end),
    );
    for (const s of ["GPSFIX", "+35.6895", "GPSEND", "mebx"]) {
      expect(contains(built.bytes, s)).toBe(true);
      expect(contains(copy, s)).toBe(false);
    }
    // Still a video with its picture track; nothing more to clear.
    expect(meta.width).toBe(1920);
    expect(again).toMatchObject({ width: 1920, patches: [] });
  });

  it("blanks any other top-level box, and keeps empty padding", async () => {
    const vendor = buildMp4({
      vendorBox: { type: "wxyz", text: "VENDOR-GPS-35.6895" },
    });
    const { copy } = await neutralise(vendor.bytes);
    expect(contains(copy, "VENDOR-GPS")).toBe(false);
    expect(copy.length).toBe(vendor.bytes.length);
    const filled = buildMp4({
      vendorBox: { type: "free", text: "LEFTOVER-35.6895" },
    });
    expect(contains((await neutralise(filled.bytes)).copy, "LEFTOVER")).toBe(
      false,
    );
  });

  it("refuses a fragmented file", async () => {
    const built = buildMp4({ vendorBox: { type: "moof", text: "x" } });
    await expect(
      readVideoMeta(built.bytes.length, async (o, l) =>
        built.bytes.subarray(o, o + l),
      ),
    ).rejects.toThrow("断片化");
  });
});

describe("readVideoMeta: WebM", () => {
  const built = buildWebm({
    width: 1280,
    height: 720,
    durationMs: 4321,
    // 2026-11-18T01:02:03Z
    dateUtcNs:
      BigInt(Date.UTC(2026, 10, 18, 1, 2, 3) - 978_307_200_000) * 1_000_000n,
    title: "SecretTitle",
    muxingApp: "SecretMuxer",
    trackName: "SecretTrack",
    tagLocation: "+35.6895+139.6917/",
  });

  it("voids Chapters, and refuses a subtitle track", async () => {
    const chaptered = buildWebm({ chapterTitle: "SecretChapter" });
    const { copy } = await neutralise(chaptered.bytes);
    expect(contains(chaptered.bytes, "SecretChapter")).toBe(true);
    expect(contains(copy, "SecretChapter")).toBe(false);
    expect(copy.length).toBe(chaptered.bytes.length);
    const subtitled = buildWebm({ subtitleTrack: true });
    await expect(
      readVideoMeta(subtitled.bytes.length, async (o, l) =>
        subtitled.bytes.subarray(o, o + l),
      ),
    ).rejects.toThrow("トラック");
  });

  it("voids what follows the clusters unlisted, after a cluster of unknown size too", async () => {
    for (const unknownSizeCluster of [false, true]) {
      const built = buildWebm({
        trailingAttachment: "SecretAttachment.jpg",
        // Listed in the SeekHead: the walk used to stop at the cluster.
        tagLocation: "+35.6895+139.6917/",
        unknownSizeCluster,
      });
      const { copy, again } = await neutralise(built.bytes);
      expect(contains(built.bytes, "SecretAttachment")).toBe(true);
      expect(contains(copy, "SecretAttachment")).toBe(false);
      expect(contains(copy, "CLUSTERPAYLOAD")).toBe(true);
      expect(copy.length).toBe(built.bytes.length);
      expect(again?.patches).toEqual([]);
    }
  });

  it("reads size, duration, codec, date and the Tags behind the cluster", async () => {
    expect(await read(built.bytes)).toMatchObject({
      container: "webm",
      width: 1280,
      height: 720,
      durationMs: 4321,
      codec: "vp9",
      takenAt: { at: "2026-11-18T10:02:03+09:00", source: "file_date" },
      location: { latitude: 35.6895, longitude: 139.6917 },
    });
  });

  it("voids Tags, title, date, apps and track names, keeping the size", async () => {
    const { copy, again } = await neutralise(built.bytes);
    expect(copy.length).toBe(built.bytes.length);
    for (const s of [
      "SecretTitle",
      "SecretMuxer",
      "TestWriter",
      "SecretTrack",
      "LOCATION",
      "+35.6895",
    ]) {
      expect(contains(built.bytes, s)).toBe(true);
      expect(contains(copy, s)).toBe(false);
    }
    expect(copy.subarray(built.mdat.start, built.mdat.end)).toEqual(
      built.bytes.subarray(built.mdat.start, built.mdat.end),
    );
    expect(again).toMatchObject({
      width: 1280,
      height: 720,
      durationMs: 4321,
      codec: "vp9",
      takenAt: null,
      location: null,
      patches: [],
    });
  });

  it("walks to trailing Tags without a SeekHead", async () => {
    const plain = buildWebm({ seekHead: false, tagLocation: "+1.5+2.5/" });
    const { meta, copy } = await neutralise(plain.bytes);
    expect(meta.location).toEqual({ latitude: 1.5, longitude: 2.5 });
    expect(contains(copy, "LOCATION")).toBe(false);
  });
});

describe("voidElement", () => {
  it("is exactly as long as asked, with a 1- or 8-byte size", () => {
    for (const n of [2, 3, 128, 129, 130, 5000]) {
      const v = voidElement(n);
      expect(v.length).toBe(n);
      expect(v[0]).toBe(0xec);
    }
    expect(voidElement(128)[1]).toBe(0x80 | 126);
    expect(voidElement(129)[1]).toBe(0x01);
  });
});

describe("not a video, or a broken one", () => {
  it("returns null for a PNG", async () => {
    const png = Uint8Array.of(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
    );
    expect(await read(png)).toBeNull();
    expect(videoContainerOf(png)).toBeNull();
  });

  it("refuses a cut file instead of hanging", async () => {
    const { bytes } = buildMp4();
    for (const n of [20, 40, 100, 300]) {
      await expect(read(bytes.slice(0, n))).rejects.toThrow();
    }
    const webm = buildWebm({ tagLocation: "+1+2/" }).bytes;
    for (const n of [10, 50]) {
      await expect(read(webm.slice(0, n))).rejects.toThrow();
    }
  });

  it("stops on garbage box sizes", async () => {
    const bytes = new Uint8Array(64);
    bytes.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    // A second box claiming to be 4 bytes long.
    bytes.set([0, 0, 0, 4, 0x6d, 0x6f, 0x6f, 0x76], 16);
    await expect(read(bytes)).rejects.toThrow();
  });
});

describe("helpers", () => {
  it("converts dates and positions", () => {
    expect(appleDateToIso("2026-11-18T10:20:30+0900")).toBe(
      "2026-11-18T10:20:30+09:00",
    );
    expect(appleDateToIso("2026-11-18T10:20:30.123456-0500")).toBe(
      "2026-11-18T10:20:30.123-05:00",
    );
    expect(appleDateToIso("yesterday")).toBeNull();
    expect(qtTimeToIso(0)).toBeNull();
    expect(qtTimeToIso(QT_2026)).toBe("2026-11-18T10:02:03+09:00");
    expect(parseIso6709("+35.6895+139.6917+040.000/")).toEqual({
      latitude: 35.6895,
      longitude: 139.6917,
    });
    expect(parseIso6709("+95.0+10.0/")).toBeNull();
  });
});

describe("the ffmpeg clip (e2e/fixtures/clip-meta.mp4)", () => {
  const clip = new Uint8Array(
    readFileSync(new URL("../../e2e/fixtures/clip-meta.mp4", import.meta.url)),
  );

  it("is read, and its copy says nothing of where or with what", async () => {
    const { meta, copy, again } = await neutralise(clip);
    expect(meta).toMatchObject({
      container: "mp4",
      width: 320,
      height: 180,
      codec: "vp09",
      location: { latitude: 35.6895, longitude: 139.6917 },
      make: "TestMake",
      model: "TestModel",
      takenAt: { at: "2026-11-18T10:20:30+09:00", source: "exif" },
    });
    expect(meta.durationMs).toBeGreaterThanOrEqual(1900);
    expect(meta.durationMs).toBeLessThanOrEqual(2100);
    expect(copy.length).toBe(clip.length);
    for (const s of ["+35.6895", "TestMake", "TestModel", "2026-11-18"]) {
      expect(contains(clip, s)).toBe(true);
      expect(contains(copy, s)).toBe(false);
    }
    expect(again).toMatchObject({
      width: 320,
      height: 180,
      location: null,
      make: null,
      model: null,
      takenAt: null,
    });
  });

  it("the WebM clip is read too", async () => {
    const webm = new Uint8Array(
      readFileSync(new URL("../../e2e/fixtures/clip.webm", import.meta.url)),
    );
    const meta = await read(webm);
    expect(meta).toMatchObject({
      container: "webm",
      width: 320,
      height: 180,
      codec: "vp9",
    });
    const copy = applyPatches(webm, meta!.patches);
    expect(copy.length).toBe(webm.length);
    expect(contains(copy, "Lavc")).toBe(false);
  });
});
