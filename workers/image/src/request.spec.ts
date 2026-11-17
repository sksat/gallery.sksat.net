import { describe, expect, it } from "vitest";
import {
  parseImagePath,
  pickFormat,
  transformOptions,
  variesByAccept,
} from "./request";

describe("parseImagePath", () => {
  it("parses a preset and a nested file", () => {
    expect(
      parseImagePath("/img/h240/VRChat/2023-12/VRChat_2023-12-11_01.png"),
    ).toEqual({ preset: "h240", file: "/VRChat/2023-12/VRChat_2023-12-11_01.png" });
  });

  it("accepts JPG in any case", () => {
    expect(parseImagePath("/img/w1200/2023-12-comsys2023/DSC1.JPG")).toEqual({
      preset: "w1200",
      file: "/2023-12-comsys2023/DSC1.JPG",
    });
  });

  it.each([
    ["unknown preset", "/img/h241/a.png"],
    ["prototype key as preset", "/img/toString/a.png"],
    ["no file", "/img/h240/"],
    ["no file segment", "/img/h240"],
    ["outside /img", "/foo/h240/a.png"],
    ["dot-dot segment", "/img/h240/../a.png"],
    ["empty segment", "/img/h240/a//b.png"],
    ["encoded characters", "/img/h240/a%2F..%2Fb.png"],
    ["not an image", "/img/h240/media.json"],
  ])("rejects %s", (_, path) => {
    expect(parseImagePath(path)).toBeNull();
  });
});

describe("pickFormat", () => {
  it("prefers AVIF, then WebP, then JPEG", () => {
    expect(pickFormat("image/avif,image/webp,*/*")).toBe("avif");
    expect(pickFormat("image/webp,*/*")).toBe("webp");
    expect(pickFormat("*/*")).toBe("jpeg");
    expect(pickFormat(null)).toBe("jpeg");
  });
});

describe("transformOptions", () => {
  const origin = "https://gallery.sksat.net";

  it("scales regular presets down in the best accepted format", () => {
    expect(transformOptions("h240", "image/avif,*/*", origin)).toEqual({
      height: 240,
      fit: "scale-down",
      format: "avif",
    });
    expect(transformOptions("w1920", "image/webp", origin)).toEqual({
      width: 1920,
      fit: "scale-down",
      format: "webp",
    });
  });

  it("crops og to a 1200x630 JPEG card with the badge in the corner", () => {
    expect(transformOptions("og", "image/avif,image/webp,*/*", origin)).toEqual(
      {
        width: 1200,
        height: 630,
        fit: "cover",
        gravity: "auto",
        format: "jpeg",
        quality: 85,
        draw: [
          { url: "https://gallery.sksat.net/og-badge.png", left: 32, bottom: 32 },
        ],
      },
    );
  });

  it("parses the og preset", () => {
    expect(parseImagePath("/img/og/VRChat/2023-12/a.png")).toEqual({
      preset: "og",
      file: "/VRChat/2023-12/a.png",
    });
  });
});

describe("variesByAccept", () => {
  it("is false only for og, whose format is fixed", () => {
    expect(variesByAccept("h240")).toBe(true);
    expect(variesByAccept("og")).toBe(false);
  });
});
