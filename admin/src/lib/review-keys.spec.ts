import { describe, expect, it } from "vitest";
import {
  reviewKey,
  swipe,
  withViewer,
  withoutViewer,
  type KeyInput,
} from "./review-keys";

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  repeat: false,
  isComposing: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  targetTag: "BODY",
  ...over,
});

describe("reviewKey", () => {
  it("steps with the arrow keys, on the page and in the viewer", () => {
    for (const inViewer of [false, true]) {
      expect(reviewKey(key("ArrowLeft"), inViewer)).toEqual({ type: "prev" });
      expect(reviewKey(key("ArrowRight"), inViewer)).toEqual({
        type: "next",
      });
      // Holding an arrow keeps stepping.
      expect(reviewKey(key("ArrowRight", { repeat: true }), inViewer)).toEqual({
        type: "next",
      });
    }
  });

  it("sets the visibility with 1/2/3 in the viewer only", () => {
    expect(reviewKey(key("1"), true)).toEqual({
      type: "visibility",
      visibility: "private",
    });
    expect(reviewKey(key("2"), true)).toEqual({
      type: "visibility",
      visibility: "unlisted",
    });
    expect(reviewKey(key("3"), true)).toEqual({
      type: "visibility",
      visibility: "public",
    });
    expect(reviewKey(key("3"), false)).toBeNull();
    expect(reviewKey(key("4"), true)).toBeNull();
    // Held down: once only.
    expect(reviewKey(key("3", { repeat: true }), true)).toBeNull();
  });

  it("leaves typing, IME composition and modifier shortcuts alone", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(reviewKey(key("ArrowLeft", { targetTag: tag }), true)).toBeNull();
      expect(reviewKey(key("1", { targetTag: tag }), true)).toBeNull();
    }
    // Radio buttons take the arrows; a checkbox does not.
    expect(
      reviewKey(
        key("ArrowLeft", { targetTag: "INPUT", targetType: "radio" }),
        false,
      ),
    ).toBeNull();
    expect(
      reviewKey(key("1", { targetTag: "INPUT", targetType: "checkbox" }), true),
    ).toEqual({ type: "visibility", visibility: "private" });
    expect(reviewKey(key("1", { targetEditable: true }), true)).toBeNull();
    expect(reviewKey(key("1", { isComposing: true }), true)).toBeNull();
    expect(reviewKey(key("Process"), true)).toBeNull();
    expect(reviewKey(key("ArrowLeft", { altKey: true }), true)).toBeNull();
    expect(reviewKey(key("1", { ctrlKey: true }), true)).toBeNull();
    expect(reviewKey(key("ArrowRight", { metaKey: true }), false)).toBeNull();
  });
});

describe("swipe", () => {
  it("left is next, right is previous", () => {
    expect(swipe(-80, 10)).toBe("next");
    expect(swipe(80, -10)).toBe("prev");
  });

  it("ignores short and mostly vertical moves", () => {
    expect(swipe(-30, 0)).toBeNull();
    expect(swipe(-80, 70)).toBeNull();
  });
});

describe("withViewer / withoutViewer", () => {
  it("adds and removes fs=1, keeping the rest of the query", () => {
    expect(withViewer("/media/2/")).toBe("/media/2/?fs=1");
    expect(withViewer("/media/2/?back=%2Fmedia%2F%3Fq%3Dx")).toBe(
      "/media/2/?back=%2Fmedia%2F%3Fq%3Dx&fs=1",
    );
    expect(withoutViewer("/media/2/?back=%2Fmedia%2F&fs=1")).toBe(
      "/media/2/?back=%2Fmedia%2F",
    );
    expect(withoutViewer("/media/2/?fs=1")).toBe("/media/2/");
  });
});
