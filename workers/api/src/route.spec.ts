import { describe, expect, it } from "vitest";
import {
  CACHE_CONTROL,
  jsonResponse,
  parseRoute,
  parseWorldRoute,
} from "./route";

describe("parseWorldRoute", () => {
  it("takes a photo's world preview path", () => {
    expect(parseWorldRoute("/api/media/abcdefghjk/world")).toBe("abcdefghjk");
    expect(parseWorldRoute("/api/media/abcdefghjk/world/")).toBe(
      "abcdefghjk",
    );
  });

  it("rejects anything else", () => {
    for (const path of [
      "/api/media/abcdefghjo/world",
      "/api/media/abcdefghjk",
      "/api/media/abcdefghjk/world/x",
      "/api/world/wrld_00000000-0000-0000-0000-000000000000",
    ]) {
      expect(parseWorldRoute(path), path).toBeNull();
    }
  });
});

describe("parseRoute", () => {
  it("routes the list and item paths", () => {
    expect(parseRoute("/api/media")).toEqual({ kind: "media-list" });
    expect(parseRoute("/api/media/")).toEqual({ kind: "media-list" });
    expect(parseRoute("/api/media/abcdefghjk")).toEqual({
      kind: "media",
      id: "abcdefghjk",
    });
    expect(parseRoute("/api/camera")).toEqual({ kind: "camera-list" });
    expect(parseRoute("/api/camera/virtuallens2")).toEqual({
      kind: "camera",
      slug: "virtuallens2",
    });
  });

  it("rejects malformed ids before they reach D1", () => {
    for (const path of [
      "/api/media/abcdefghj", // too short
      "/api/media/abcdefghjo", // 'o' is not in the alphabet
      "/api/media/ABCDEFGHJK",
      "/api/media/legacy/0", // the old /photo/<N> lookup is gone
      "/api/media/legacy",
      "/api/media/abcdefghjk/extra",
      "/api/camera/Bad_Slug",
      "/api/camera/-a",
      "/api/camera/a/b",
      "/api/cameras",
      "/api/photos",
      "/api",
      "/",
      "/media",
    ]) {
      expect(parseRoute(path), path).toBeNull();
    }
  });
});

describe("jsonResponse", () => {
  it("sets JSON and cache headers", async () => {
    const res = jsonResponse(200, { a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("takes another cache policy", () => {
    expect(
      jsonResponse(500, {}, "no-store").headers.get("Cache-Control"),
    ).toBe("no-store");
  });
});
