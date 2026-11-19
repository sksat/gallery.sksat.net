import { describe, expect, it } from "vitest";
import { parseVideoUrl, playObjectKey } from "./video";

const u = (path: string) => new URL(`https://gallery.sksat.net${path}`);

describe("parseVideoUrl", () => {
  it("takes /video/<public_id> and nothing else", () => {
    expect(parseVideoUrl(u("/video/abcdefghjk"))).toEqual({ id: "abcdefghjk" });
    expect(parseVideoUrl(u("/video/abcdefghjk?t=1"))).toEqual({ status: 400 });
    for (const bad of [
      "/video/abcdefghjk/",
      "/video/abcdefghij",
      "/video/a.mp4",
      "/video/",
      "/img/abcdefghjk",
    ]) {
      expect(parseVideoUrl(u(bad)), bad).toBeNull();
    }
  });
});

describe("playObjectKey", () => {
  it("is the R2 key of a playback copy, and nothing else", () => {
    const key = "/v/abcdefghjkabcdefghjk.mp4";
    expect(playObjectKey({ storage: "r2", key })).toBe(key.slice(1));
    expect(playObjectKey({ storage: "b2", key })).toBeNull();
    expect(playObjectKey({ storage: "r2", key: "/clips/a.mp4" })).toBeNull();
    expect(playObjectKey(null)).toBeNull();
  });
});
