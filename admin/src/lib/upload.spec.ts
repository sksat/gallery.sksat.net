import { describe, expect, it } from "vitest";
import {
  checkUploadLimits,
  formatUploadSize,
  formatMegapixelsUp,
  groupDigits,
  guessPlatform,
  MAX_UPLOAD_BYTES,
  safeSegment,
  uploadContentType,
  uploadTarget,
  validateUploadInit,
} from "./upload";

describe("uploadContentType", () => {
  it("accepts PNG and JPEG by extension, agreeing with the browser", () => {
    expect(uploadContentType("a.PNG", "image/png")).toBe("image/png");
    expect(uploadContentType("a.jpeg", "image/jpeg")).toBe("image/jpeg");
    expect(uploadContentType("a.JPG", "")).toBe("image/jpeg");
  });

  it("refuses other files and mismatched types", () => {
    expect(uploadContentType("a.heic", "image/heic")).toBeNull();
    expect(uploadContentType("a.gif", "image/gif")).toBeNull();
    expect(uploadContentType("notes.txt", "text/plain")).toBeNull();
    expect(uploadContentType("a.jpg", "image/heic")).toBeNull();
    expect(uploadContentType("noext", "image/png")).toBeNull();
  });
});

describe("safeSegment", () => {
  it("replaces unsafe characters and keeps safe names", () => {
    expect(safeSegment("IMG_0001.JPG", 120)).toBe("IMG_0001.JPG");
    expect(safeSegment("My Photo (1).jpg", 120)).toBe("My_Photo_1_.jpg");
    expect(safeSegment(" 写真 2026.png ", 120)).toBe("_2026.png");
    expect(safeSegment(".hidden.png", 120)).toBe("_hidden.png");
    expect(safeSegment("日本語", 120)).toBe("");
    expect(safeSegment("..", 120)).toBe("_.");
  });

  it("shortens long names but keeps the extension", () => {
    expect(safeSegment(`${"a".repeat(200)}.jpeg`, 20)).toBe(
      `${"a".repeat(15)}.jpeg`,
    );
    expect(safeSegment("b".repeat(30), 10)).toBe("b".repeat(10));
  });
});

describe("uploadTarget", () => {
  it("puts a picked file in the open folder", () => {
    expect(uploadTarget("/VRChat/2026-11", "a.png")).toEqual({
      ok: true,
      file: "/VRChat/2026-11/a.png",
      dir: "/VRChat/2026-11",
    });
    expect(uploadTarget("/", "IMG 1.jpg")).toEqual({
      ok: true,
      file: "/IMG_1.jpg",
      dir: "/",
    });
  });

  it("creates subfolders from a folder upload's relative path", () => {
    expect(uploadTarget("/trip", "Day 1/raw/IMG_1.JPG")).toEqual({
      ok: true,
      file: "/trip/Day_1/raw/IMG_1.JPG",
      dir: "/trip/Day_1/raw",
    });
  });

  it("refuses non-images, unusable names and reserved or too deep folders", () => {
    expect(uploadTarget("/a", "notes.txt")).toEqual({
      ok: false,
      error: "PNG / JPEG ではありません",
    });
    expect(uploadTarget("/a", ".DS_Store")).toEqual({
      ok: false,
      error: "PNG / JPEG ではありません",
    });
    expect(uploadTarget("/a", "日本語/a.png").ok).toBe(false);
    expect(uploadTarget("/a", "").ok).toBe(false);
    expect(uploadTarget("/", "camera/x/a.png").ok).toBe(false);
    expect(uploadTarget("/a/b/c/d/e/f/g", "h/i/a.png").ok).toBe(false);
    // ".." in a relative path is just a name, made safe.
    expect(uploadTarget("/a", "../a.png")).toEqual({
      ok: true,
      file: "/a/_./a.png",
      dir: "/a/_.",
    });
  });
});

describe("guessPlatform", () => {
  it("is VRChat for VRChat's screenshot names", () => {
    expect(
      guessPlatform("/x/VRChat_2026-11-18_01-02-03.456_3840x2160.png"),
    ).toBe("VRChat");
    // Before late 2022 the resolution came first.
    expect(
      guessPlatform("/x/VRChat_3840x2160_2022-08-22_02-03-18.591.png"),
    ).toBe("VRChat");
    expect(guessPlatform("/x/IMG_1.jpg")).toBe("Real");
  });

  it("is VRChat for anything under the top-level /VRChat/ folder", () => {
    expect(guessPlatform("/VRChat/IMG_1.jpg")).toBe("VRChat");
    expect(guessPlatform("/VRChat/2026-11/edited.png")).toBe("VRChat");
    expect(guessPlatform("/Trip/VRChat/IMG_1.jpg")).toBe("Real");
    expect(guessPlatform("/VRChatX/IMG_1.jpg")).toBe("Real");
  });
});

describe("validateUploadInit", () => {
  const ok = {
    file: "/VRChat/2026-11/a.png",
    size: 1234,
    contentType: "image/png",
    sha256: "0".repeat(64),
    timestamp: "2026-11-18T01:02:03.456+09:00",
  };

  it("accepts a well-formed request", () => {
    expect(validateUploadInit(ok)).toEqual({ ok: true, init: ok });
    expect(validateUploadInit({ ...ok, timestamp: null })).toEqual({
      ok: true,
      init: { ...ok, timestamp: null },
    });
  });

  it("keeps only the well-formed parts of the file's metadata", () => {
    const meta = {
      exif: { make: " Sony ", iso: 100, f_number: "2.8", serial: "123" },
      location: { latitude: 35.5, longitude: 139.5 },
      world: { id: "wrld_abc", name: "W", authorId: "not an id" },
    };
    expect(validateUploadInit({ ...ok, meta })).toEqual({
      ok: true,
      init: {
        ...ok,
        meta: {
          exif: { make: "Sony", iso: 100 },
          location: { latitude: 35.5, longitude: 139.5 },
          world: { id: "wrld_abc", name: "W", authorId: null },
        },
      },
    });
    expect(
      validateUploadInit({
        ...ok,
        meta: {
          exif: { x: 1 },
          location: { latitude: 91, longitude: 0 },
          world: { id: "usr_x" },
        },
      }),
    ).toEqual({
      ok: true,
      init: { ...ok, meta: { exif: null, location: null, world: null } },
    });
  });

  it("refuses anything off", () => {
    for (const bad of [
      null,
      [],
      { ...ok, file: "/a/../b.png" },
      { ...ok, file: " /VRChat/2026-11/a.png" },
      { ...ok, file: "/camera/x/a.png" },
      { ...ok, file: "/a b/c.png" },
      { ...ok, size: 0 },
      { ...ok, size: MAX_UPLOAD_BYTES + 1 },
      { ...ok, size: 1.5 },
      { ...ok, contentType: "image/jpeg" },
      { ...ok, sha256: "A".repeat(64) },
      { ...ok, sha256: "0".repeat(63) },
      { ...ok, timestamp: "2026-11-18 01:02:03" },
      { ...ok, timestamp: "2026-11-18T01:02:03" },
      { ...ok, width: 0, height: 10 },
      { ...ok, width: "10", height: 10 },
      { ...ok, width: 1.5, height: 10 },
    ]) {
      expect(validateUploadInit(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  // What the browser and the server both say.
  const TOO_BIG =
    "ファイルが大きすぎます：123.4 MB（117.7 MiB）。上限は 100 MB（95.4 MiB）です。";
  const TOO_WIDE =
    "画像が大きすぎます：13,000 × 9,000 px。1 辺 12,000 px までです。";
  const TOO_DENSE = "画素数が多すぎます：120 MP。上限は 100 MP です。";

  it("checks the limits again, with the same words as the browser", () => {
    expect(validateUploadInit({ ...ok, size: 123_400_000 })).toEqual({
      ok: false,
      error: TOO_BIG,
    });
    expect(validateUploadInit({ ...ok, width: 13_000, height: 9_000 })).toEqual(
      { ok: false, error: TOO_WIDE },
    );
    expect(
      validateUploadInit({ ...ok, width: 12_000, height: 10_000 }),
    ).toEqual({ ok: false, error: TOO_DENSE });
    // Within them (or unknown): accepted, and not stored.
    expect(validateUploadInit({ ...ok, width: 3840, height: 2160 })).toEqual({
      ok: true,
      init: ok,
    });
    expect(validateUploadInit({ ...ok, width: null, height: null })).toEqual({
      ok: true,
      init: ok,
    });
  });

  it("answers in Japanese, without raw byte counts", () => {
    for (const bad of [
      null,
      { ...ok, file: "/a/../b.png" },
      { ...ok, size: 1.5 },
      { ...ok, contentType: "image/jpeg" },
      { ...ok, sha256: "x" },
      { ...ok, timestamp: "x" },
    ]) {
      const v = validateUploadInit(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toMatch(/[ぁ-んァ-ン]/);
    }
  });
});

describe("checkUploadLimits", () => {
  it("lets through what Cloudflare can resize", () => {
    expect(checkUploadLimits({ size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(
      checkUploadLimits({ size: 40_000_000, width: 7680, height: 4320 }),
    ).toBeNull();
    expect(
      checkUploadLimits({ size: 1, width: 12_000, height: 8_333 }),
    ).toBeNull();
    // Exactly at the limits.
    expect(
      checkUploadLimits({ size: 1, width: 12_000, height: 1 }),
    ).toBeNull();
    expect(
      checkUploadLimits({ size: 1, width: 10_000, height: 10_000 }),
    ).toBeNull();
    expect(
      checkUploadLimits({ size: 1, width: 12_001, height: 1 }),
    ).not.toBeNull();
    // Unknown dimensions: only the size counts.
    expect(
      checkUploadLimits({ size: 1, width: null, height: null }),
    ).toBeNull();
  });

  it("says why in readable units", () => {
    expect(checkUploadLimits({ size: 123_400_000 })).toBe(
      "ファイルが大きすぎます：123.4 MB（117.7 MiB）。上限は 100 MB（95.4 MiB）です。",
    );
    // Just over the limit never reads as the limit.
    expect(checkUploadLimits({ size: MAX_UPLOAD_BYTES + 1 })).toBe(
      "ファイルが大きすぎます：100.1 MB（95.4 MiB）。上限は 100 MB（95.4 MiB）です。",
    );
    expect(checkUploadLimits({ size: 0 })).toBe("空のファイルです");
    expect(checkUploadLimits({ size: 1, width: 13_000, height: 9_000 })).toBe(
      "画像が大きすぎます：13,000 × 9,000 px。1 辺 12,000 px までです。",
    );
    expect(checkUploadLimits({ size: 1, width: 5_000, height: 12_001 })).toBe(
      "画像が大きすぎます：5,000 × 12,001 px。1 辺 12,000 px までです。",
    );
    expect(checkUploadLimits({ size: 1, width: 12_000, height: 10_000 })).toBe(
      "画素数が多すぎます：120 MP。上限は 100 MP です。",
    );
    expect(checkUploadLimits({ size: 1, width: 10_001, height: 10_000 })).toBe(
      "画素数が多すぎます：100.1 MP。上限は 100 MP です。",
    );
  });
});

describe("formatUploadSize", () => {
  it("shows decimal units, then binary ones in parentheses", () => {
    expect(formatUploadSize(123_400_000)).toBe("123.4 MB（117.7 MiB）");
    expect(formatUploadSize(MAX_UPLOAD_BYTES)).toBe("100 MB（95.4 MiB）");
    expect(formatUploadSize(37 * 1024 * 1024)).toBe("38.8 MB（37 MiB）");
    expect(formatUploadSize(65_536)).toBe("65.6 KB（64 KiB）");
    expect(formatUploadSize(2_000_000_000)).toBe("2 GB（1.9 GiB）");
    // Under a kibibyte: just bytes.
    expect(formatUploadSize(1000)).toBe("1,000 バイト");
    expect(formatUploadSize(500)).toBe("500 バイト");
  });

  it("moves up a unit when rounding up reaches it", () => {
    expect(formatUploadSize(999_999)).toBe("1 MB（976.6 KiB）");
    expect(formatUploadSize(1_048_575)).toBe("1.1 MB（1 MiB）");
  });

  it("rounds up to a tenth", () => {
    expect(formatUploadSize(123_400_001)).toBe("123.5 MB（117.7 MiB）");
    expect(formatUploadSize(MAX_UPLOAD_BYTES + 1)).toBe("100.1 MB（95.4 MiB）");
  });
});

describe("formatMegapixelsUp / groupDigits", () => {
  it("rounds megapixels up to a tenth", () => {
    expect(formatMegapixelsUp(120_000_000)).toBe("120 MP");
    expect(formatMegapixelsUp(100_000_000)).toBe("100 MP");
    expect(formatMegapixelsUp(100_000_001)).toBe("100.1 MP");
  });

  it("groups digits", () => {
    expect(groupDigits(12000)).toBe("12,000");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1234567)).toBe("1,234,567");
  });
});
