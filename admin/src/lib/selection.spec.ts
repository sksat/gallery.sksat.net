import { describe, expect, it } from "vitest";
import {
  clickItem,
  EMPTY_SELECTION,
  keepShown,
  selectAll,
  sharedVisibility,
  splitSelection,
  visibilityPending,
  type SelKey,
} from "./selection";
import { exposing } from "./review-pending";

describe("visibilityPending", () => {
  const photos = [
    { id: 1, file: "/a.png", visibility: "private" as const },
    { id: 2, file: "/b.png", visibility: "public" as const },
    { id: 3, file: "/c.png", visibility: "unlisted" as const },
  ];

  it("lists the photos that change, so exposing() asks only for those", () => {
    const p = visibilityPending(photos, "public");
    expect(p).toEqual({
      1: { to: "public", from: "private", file: "/a.png" },
      3: { to: "public", from: "unlisted", file: "/c.png" },
    });
    expect(exposing(p).map(([id]) => id)).toEqual([1, 3]);
  });

  it("making photos private needs no look", () => {
    expect(exposing(visibilityPending(photos, "private"))).toEqual([]);
  });

  it("a level they all have already changes nothing", () => {
    expect(visibilityPending([photos[1]], "public")).toEqual({});
  });
});

describe("sharedVisibility", () => {
  it("is the level all photos have, else null", () => {
    expect(sharedVisibility([{ visibility: "public" }])).toBe("public");
    expect(
      sharedVisibility([{ visibility: "public" }, { visibility: "private" }]),
    ).toBeNull();
    expect(sharedVisibility([])).toBeNull();
  });
});

const order: SelKey[] = ["f:/a", "f:/b", "p:1", "p:2", "p:3", "p:4"];
const none = { range: false, toggle: false };
const toggle = { range: false, toggle: true };
const range = { range: true, toggle: false };

describe("clickItem", () => {
  it("toggles one item and makes it the anchor", () => {
    let s = clickItem(order, EMPTY_SELECTION, "p:2", toggle);
    expect(s).toEqual({ keys: ["p:2"], anchor: "p:2" });
    s = clickItem(order, s, "f:/a", toggle);
    expect(s.keys).toEqual(["f:/a", "p:2"]);
    s = clickItem(order, s, "p:2", none);
    expect(s).toEqual({ keys: ["f:/a"], anchor: "p:2" });
  });

  it("selects a range from the anchor, either way", () => {
    const start = clickItem(order, EMPTY_SELECTION, "p:3", toggle);
    expect(clickItem(order, start, "f:/b", range).keys).toEqual([
      "f:/b",
      "p:1",
      "p:2",
      "p:3",
    ]);
    expect(clickItem(order, start, "p:4", range)).toEqual({
      keys: ["p:3", "p:4"],
      anchor: "p:3",
    });
  });

  it("replaces the selection with a range, or adds it with Ctrl", () => {
    let s = clickItem(order, EMPTY_SELECTION, "f:/a", toggle);
    s = clickItem(order, s, "p:3", toggle);
    expect(clickItem(order, s, "p:4", range).keys).toEqual(["p:3", "p:4"]);
    expect(
      clickItem(order, s, "p:4", { range: true, toggle: true }).keys,
    ).toEqual(["f:/a", "p:3", "p:4"]);
  });

  it("treats Shift without an anchor as a toggle", () => {
    expect(clickItem(order, EMPTY_SELECTION, "p:1", range)).toEqual({
      keys: ["p:1"],
      anchor: "p:1",
    });
  });
});

describe("selectAll / keepShown / splitSelection", () => {
  it("selects everything shown", () => {
    expect(selectAll(order).keys).toEqual(order);
  });

  it("drops keys that are no longer shown", () => {
    const s = { keys: ["p:1", "p:9"] as SelKey[], anchor: "p:9" as SelKey };
    expect(keepShown(order, s)).toEqual({ keys: ["p:1"], anchor: null });
    const same = { keys: ["p:1"] as SelKey[], anchor: "p:1" as SelKey };
    expect(keepShown(order, same)).toBe(same);
  });

  it("splits photos and folders", () => {
    expect(splitSelection(["f:/a/b", "p:12", "p:3"])).toEqual({
      photos: [12, 3],
      folders: ["/a/b"],
    });
  });
});
