import { describe, expect, it } from "vitest";
import {
  LIST_CANDIDATES,
  PRESETS,
  PREVIEW_CANDIDATES,
  dimensionsFromFile,
  fileExtension,
  imageUrl,
  srcSet,
} from "./images";

const BASE = "https://gallery.sksat.net/img";
const FILE = "/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png";

describe("PRESETS", () => {
  it("matches the image Worker's preset list", () => {
    // workers/image/src/request.ts — the Worker 404s any other name.
    expect(PRESETS).toEqual(["h240", "h480", "w1200", "w1920", "w2560", "w3840"]);
  });

  it("only uses known presets in the candidate lists", () => {
    for (const [p] of [...LIST_CANDIDATES, ...PREVIEW_CANDIDATES]) {
      expect(PRESETS).toContain(p);
    }
  });
});

describe("imageUrl", () => {
  it("joins base, preset and the row's file path", () => {
    expect(imageUrl(BASE, FILE, "h240")).toBe(`${BASE}/h240${FILE}`);
  });

  it("adds the slash for a file without a leading one", () => {
    expect(imageUrl(BASE, "a.png", "w1200")).toBe(`${BASE}/w1200/a.png`);
  });
});

describe("srcSet", () => {
  it("lists each candidate with its descriptor", () => {
    expect(srcSet(BASE, "/a.png", LIST_CANDIDATES)).toBe(
      `${BASE}/h240/a.png 1x, ${BASE}/h480/a.png 2x`,
    );
    expect(srcSet(BASE, "/a.png", PREVIEW_CANDIDATES)).toBe(
      `${BASE}/w1200/a.png 1200w, ${BASE}/w1920/a.png 1920w`,
    );
  });
});

describe("dimensionsFromFile", () => {
  it("reads VRChat's WxH suffix", () => {
    expect(dimensionsFromFile(FILE)).toEqual({ width: 7680, height: 4320 });
  });

  it("is empty without a size", () => {
    expect(dimensionsFromFile("/2023-12-comsys2023/IMG_0001.jpg")).toEqual({});
    expect(dimensionsFromFile("/a_0x10.png")).toEqual({});
  });
});

describe("fileExtension", () => {
  it("upper-cases the extension", () => {
    expect(fileExtension("/mock/real1.png")).toBe("PNG");
    expect(fileExtension("/a/b.JpEg")).toBe("JPEG");
  });

  it("is empty without one", () => {
    expect(fileExtension("/a/b")).toBe("");
  });
});
