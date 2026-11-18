import { describe, expect, it } from "vitest";
import {
  parseAdminImage,
  parseImagePath,
  pickFormat,
  transformFailed,
  transformOptions,
  variesByAccept,
  withoutAvif,
} from "./request";

describe("withoutAvif", () => {
  it("drops AVIF so WebP (or JPEG) is picked", () => {
    expect(pickFormat(withoutAvif("image/avif,image/webp,*/*"))).toBe("webp");
    expect(pickFormat(withoutAvif("image/avif;q=0.9, */*"))).toBe("jpeg");
    expect(withoutAvif(null)).toBeNull();
  });
});

describe("parseAdminImage", () => {
  it("accepts a resize preset and a bucket path", () => {
    expect(parseAdminImage("h240", "/VRChat/2023-12/a.png")).toEqual({
      preset: "h240",
      file: "/VRChat/2023-12/a.png",
    });
    expect(parseAdminImage("w1920", "/camera/vl2/front.png")).toEqual({
      preset: "w1920",
      file: "/camera/vl2/front.png",
    });
  });

  it.each([
    ["a card preset", "og", "/a.png"],
    ["an unknown preset", "h241", "/a.png"],
    ["a preset with a slash", "h240/x", "/a.png"],
    ["a public id instead of a file", "h240", "/abcdefghjk"],
    ["a relative file", "h240", "a.png"],
    ["a dot-dot segment", "h240", "/a/../b.png"],
    ["a literal percent sign", "h240", "/a%2Fb.png"],
    ["a decoded traversal", "h240", "/a/../../b.png"],
    ["an empty segment", "h240", "/a//b.png"],
    ["not an image", "h240", "/media.json"],
    ["a non-string", "h240", 3],
  ])("rejects %s", (_, preset, file) => {
    expect(parseAdminImage(preset, file)).toBeNull();
  });
});

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

  it("parses a photo's public id", () => {
    expect(parseImagePath("/img/og/abcdefghjk")).toEqual({
      preset: "og",
      id: "abcdefghjk",
    });
  });

  it.each([
    ["malformed public id", "/img/h240/abcdefghjo"],
    ["public id with a trailing slash", "/img/h240/abcdefghjk/"],
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
      metadata: "none",
    });
    expect(transformOptions("w1920", "image/webp", origin)).toEqual({
      width: 1920,
      fit: "scale-down",
      format: "webp",
      metadata: "none",
    });
  });

  it("strips the originals' metadata from every preset", () => {
    for (const preset of ["h240", "w3840", "og", "og-site"] as const) {
      expect(transformOptions(preset, null, origin).metadata).toBe("none");
    }
  });

  const card = {
    width: 1200,
    height: 630,
    fit: "cover",
    gravity: "auto",
    format: "jpeg",
    quality: 85,
    metadata: "none",
  };
  const badge = {
    url: "https://gallery.sksat.net/og-badge.png",
    left: 32,
    bottom: 32,
  };
  const shade = {
    url: "https://gallery.sksat.net/og-shade.png",
    left: 0,
    bottom: 0,
  };
  const text = (s: string, size: number, bottom: number) => ({
    text: s,
    font: { url: "https://gallery.sksat.net/fonts/Roboto-Bold-subset.ttf" },
    color: "#ffffff",
    size,
    right: 40,
    bottom,
  });
  const caption = {
    primary: "2023-12-16 23:12 JST",
    secondary: "logilabo VirtualLens2 · #VRChat",
  };

  it("draws the caption over a shade beside the badge on og", () => {
    expect(
      transformOptions("og", "image/avif,image/webp,*/*", origin, caption),
    ).toEqual({
      ...card,
      draw: [
        shade,
        badge,
        text("logilabo VirtualLens2 · #VRChat", 28, 38),
        text("2023-12-16 23:12 JST", 40, 76),
      ],
    });
  });

  it("drops lines that are missing", () => {
    expect(
      transformOptions("og", null, origin, { secondary: "#Real" }).draw,
    ).toEqual([shade, badge, text("#Real", 28, 63)]);
    expect(
      transformOptions("og", null, origin, { primary: "2023-12-01 09:00 JST" })
        .draw,
    ).toEqual([shade, badge, text("2023-12-01 09:00 JST", 40, 56)]);
    expect(transformOptions("og", null, origin).draw).toEqual([badge]);
  });

  it("draws only the badge on og-site, even with a caption", () => {
    expect(transformOptions("og-site", "image/avif", origin, caption)).toEqual({
      ...card,
      draw: [badge],
    });
  });

  it("parses the card presets", () => {
    expect(parseImagePath("/img/og/VRChat/2023-12/a.png")).toEqual({
      preset: "og",
      file: "/VRChat/2023-12/a.png",
    });
    expect(parseImagePath("/img/og-site/a.png")?.preset).toBe("og-site");
  });
});

describe("transformFailed", () => {
  it("detects error statuses and Cf-Resized errors", () => {
    expect(transformFailed(200, "internal=ok/- q=85 n=1")).toBe(false);
    expect(transformFailed(200, null)).toBe(false);
    expect(transformFailed(200, "err=9413")).toBe(true);
    expect(transformFailed(415, null)).toBe(true);
  });
});

describe("variesByAccept", () => {
  it("is false only for cards, whose format is fixed", () => {
    expect(variesByAccept("h240")).toBe(true);
    expect(variesByAccept("og")).toBe(false);
    expect(variesByAccept("og-site")).toBe(false);
  });
});
