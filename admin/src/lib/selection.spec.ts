import { describe, expect, it } from "vitest";
import {
  clickItem,
  EMPTY_SELECTION,
  keepShown,
  inChunks,
  reconcileSelection,
  selectAll,
  sharedCamera,
  sharedPlatform,
  sharedVisibility,
  splitSelection,
  visibilityPending,
  type SelKey,
} from "./selection";
import { exposing } from "./review-pending";

describe("reconcileSelection", () => {
  const all: SelKey[] = ["p:1", "p:2", "p:3"];
  const picked = { keys: ["p:1", "p:2"] as SelKey[], anchor: "p:1" as SelKey };

  it("survives a reload of the same view that briefly lacks an item", () => {
    // The reload misses photo 2: it stays selected, though only photo 1
    // is shown (and counted, and acted on) meanwhile…
    const during = reconcileSelection(["p:1", "p:3"], picked, true);
    expect(during).toBe(picked);
    expect(keepShown(["p:1", "p:3"], during).keys).toEqual(["p:1"]);
    // …and once it is back, both are selected again.
    const after = reconcileSelection(all, during, true);
    expect(keepShown(all, after).keys).toEqual(["p:1", "p:2"]);
  });

  it("an edit by the user keeps only what is shown", () => {
    // Photo 2 is missing for a while; unticking photo 1 leaves nothing,
    // rather than photo 2 coming back selected later.
    expect(
      clickItem(["p:1", "p:3"], picked, "p:1", { range: false, toggle: true })
        .keys,
    ).toEqual([]);
  });

  it("another folder or filter keeps only what it shows", () => {
    expect(reconcileSelection(["p:2", "p:9"], picked, false)).toEqual({
      keys: ["p:2"],
      anchor: null,
    });
  });
});

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

describe("sharedCamera", () => {
  it("is the camera all have, null for none, undefined when mixed", () => {
    expect(sharedCamera([{ camera_id: 2 }, { camera_id: 2 }])).toBe(2);
    expect(sharedCamera([{ camera_id: null }])).toBeNull();
    expect(
      sharedCamera([{ camera_id: 2 }, { camera_id: null }]),
    ).toBeUndefined();
    expect(sharedCamera([])).toBeUndefined();
  });
});

describe("sharedPlatform", () => {
  it("is the platform all have, else undefined", () => {
    expect(sharedPlatform([{ platform: "Real" }])).toBe("Real");
    expect(
      sharedPlatform([{ platform: "Real" }, { platform: "VRChat" }]),
    ).toBeUndefined();
  });
});

describe("inChunks", () => {
  it("splits in order, the last run shorter", () => {
    expect(inChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inChunks([], 100)).toEqual([]);
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
