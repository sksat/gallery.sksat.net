import { describe, expect, it } from "vitest";
import {
  formatBytes,
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
    expect(uploadTarget("/a", "notes.txt").ok).toBe(false);
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
    expect(guessPlatform("/VRChat/IMG_1.jpg")).toBe("Real");
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
    ]) {
      expect(validateUploadInit(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("formatBytes", () => {
  it("is short", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(37 * 1024 * 1024)).toBe("37 MB");
  });
});
