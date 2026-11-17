import { describe, expect, it } from "vitest";
import { parseImagePath, pickFormat } from "./request";

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
