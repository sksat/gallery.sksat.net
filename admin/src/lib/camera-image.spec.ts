import { describe, expect, it } from "vitest";
import {
  cameraPictureTarget,
  dropIndex,
  firstFreeName,
  inCameraDir,
  moveToIndex,
  objectDeletable,
  orderAfter,
  sameIds,
  validateCameraUpload,
} from "./camera-image";

describe("cameraPictureTarget", () => {
  it("puts the safe file name in the camera's folder", () => {
    expect(cameraPictureTarget("/camera/x100v/", "Front view.JPG")).toEqual({
      ok: true,
      file: "/camera/x100v/Front_view.JPG",
      dir: "/camera/x100v",
    });
  });

  it("drops the folders of a dropped folder", () => {
    expect(cameraPictureTarget("/camera/x100v", "Shots/a.png")).toMatchObject({
      ok: true,
      file: "/camera/x100v/a.png",
    });
  });

  it("refuses what is not a PNG / JPEG or has no usable name", () => {
    expect(cameraPictureTarget("/camera/x/", "a.heic")).toEqual({
      ok: false,
      error: "PNG / JPEG ではありません",
    });
    expect(cameraPictureTarget("/camera/x/", "").ok).toBe(false);
    expect(cameraPictureTarget("/camera/x/", "カメラ").ok).toBe(false);
  });
});

describe("inCameraDir", () => {
  it("is true only directly in the camera's folder", () => {
    expect(inCameraDir("/camera/x/a.png", "x")).toBe(true);
    expect(inCameraDir("/camera/x/sub/a.png", "x")).toBe(false);
    expect(inCameraDir("/camera/xy/a.png", "x")).toBe(false);
    expect(inCameraDir("/camera/x/", "x")).toBe(false);
    expect(inCameraDir("/VRChat/a.png", "x")).toBe(false);
  });
});

describe("validateCameraUpload", () => {
  const ok = {
    file: "/camera/x/a.png",
    size: 1000,
    contentType: "image/png",
    sha256: "a".repeat(64),
    width: 800,
    height: 600,
  };

  it("takes a picture in the camera's folder", () => {
    expect(validateCameraUpload(ok, "x")).toEqual({
      ok: true,
      init: {
        file: "/camera/x/a.png",
        size: 1000,
        contentType: "image/png",
        sha256: "a".repeat(64),
      },
    });
  });

  it("refuses another folder, a bad hash, and what cannot be resized", () => {
    expect(
      validateCameraUpload({ ...ok, file: "/camera/y/a.png" }, "x"),
    ).toEqual({ ok: false, error: "保存先のパスが正しくありません" });
    expect(
      validateCameraUpload({ ...ok, file: "/camera/x/../a.png" }, "x").ok,
    ).toBe(false);
    expect(validateCameraUpload({ ...ok, sha256: "x" }, "x").ok).toBe(false);
    expect(
      validateCameraUpload({ ...ok, contentType: "image/jpeg" }, "x").ok,
    ).toBe(false);
    expect(validateCameraUpload({ ...ok, width: 13_000 }, "x")).toMatchObject({
      ok: false,
      error: expect.stringContaining("画像が大きすぎます"),
    });
    expect(validateCameraUpload({ ...ok, size: 0 }, "x").ok).toBe(false);
  });
});

describe("firstFreeName", () => {
  const names = ["/c/a.png", "/c/a-1.png", "/c/a-2.png", "/c/a-3.png"];

  it("skips names rows use without asking the bucket", async () => {
    const asked: string[] = [];
    const name = await firstFreeName(
      names,
      new Set(["/c/a.png"]),
      async (f) => {
        asked.push(f);
        return false;
      },
      5,
    );
    expect(name).toBe("/c/a-1.png");
    expect(asked).toEqual(["/c/a-1.png"]);
  });

  it("skips objects already in the bucket, up to the probe limit", async () => {
    const inBucket = new Set(["/c/a.png", "/c/a-1.png"]);
    const exists = async (f: string) => inBucket.has(f);
    expect(await firstFreeName(names, new Set(), exists, 5)).toBe("/c/a-2.png");
    expect(await firstFreeName(names, new Set(), exists, 2)).toBeNull();
  });
});

describe("claims and the completion's folder", () => {
  it("skips a name another upload holds", async () => {
    const name = await firstFreeName(
      ["/c/a.png", "/c/a-1.png"],
      new Set(),
      async () => false,
      5,
      async (f) => f !== "/c/a.png",
    );
    expect(name).toBe("/c/a-1.png");
  });

  it("the completion takes any camera's folder (a slug changed meanwhile)", () => {
    const body = {
      file: "/camera/old-slug/a.png",
      size: 10,
      contentType: "image/png",
      sha256: "a".repeat(64),
    };
    expect(validateCameraUpload(body, null).ok).toBe(true);
    expect(validateCameraUpload(body, "new-slug").ok).toBe(false);
    expect(
      validateCameraUpload({ ...body, file: "/VRChat/a.png" }, null).ok,
    ).toBe(false);
    expect(
      validateCameraUpload({ ...body, file: "/camera/a/b/c.png" }, null).ok,
    ).toBe(false);
  });
});

describe("order", () => {
  it("moves a picture to an index", () => {
    expect(moveToIndex([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
    expect(moveToIndex([1, 2, 3], 1, 9)).toEqual([2, 3, 1]);
    expect(moveToIndex([1, 2, 3], 2, 1)).toBeNull();
    expect(moveToIndex([1, 2, 3], 9, 0)).toBeNull();
  });

  it("↑ / ↓ swap with the neighbour, デフォルトにする puts it first", () => {
    expect(orderAfter([1, 2, 3], 2, "up")).toEqual([2, 1, 3]);
    expect(orderAfter([1, 2, 3], 2, "down")).toEqual([1, 3, 2]);
    expect(orderAfter([1, 2, 3], 3, "default")).toEqual([3, 1, 2]);
    expect(orderAfter([1, 2, 3], 1, "up")).toBeNull();
    expect(orderAfter([1, 2, 3], 3, "down")).toBeNull();
    expect(orderAfter([1, 2, 3], 1, "default")).toBeNull();
  });

  it("a drop lands above or below the row under the pointer", () => {
    // Dragged down: below row 2 is index 2, above it index 1.
    expect(dropIndex(0, 2, true)).toBe(2);
    expect(dropIndex(0, 2, false)).toBe(1);
    // Dragged up: above row 0 is index 0, below it index 1.
    expect(dropIndex(2, 0, false)).toBe(0);
    expect(dropIndex(2, 0, true)).toBe(1);
    // On itself: where it is.
    expect(dropIndex(1, 1, false)).toBe(1);
    expect(dropIndex(1, 1, true)).toBe(1);
  });

  it("tells an order of the same pictures", () => {
    expect(sameIds([1, 2, 3], [3, 1, 2])).toBe(true);
    expect(sameIds([1, 2, 3], [1, 2])).toBe(false);
    expect(sameIds([1, 2, 3], [1, 2, 2])).toBe(false);
    expect(sameIds([1, 2], [1, 4])).toBe(false);
  });
});

describe("objectDeletable", () => {
  it("only for an object in a camera folder that nothing else uses", () => {
    expect(objectDeletable("/camera/x/a.png", false)).toBe(true);
    expect(objectDeletable("/camera/x/a.png", true)).toBe(false);
    expect(objectDeletable("/VRChat/a.png", false)).toBe(false);
  });
});
