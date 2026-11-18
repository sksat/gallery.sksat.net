import { describe, expect, it } from "vitest";
import {
  exposing,
  parsePending,
  pendingBatches,
  pendingCounts,
  pendingKey,
  previewOf,
  togglePending,
  type Pending,
} from "./review-pending";

describe("previewOf", () => {
  it("shows the first ones and counts the rest", () => {
    expect(previewOf([1, 2, 3], 2)).toEqual({ shown: [1, 2], more: 1 });
    expect(previewOf([1], 2)).toEqual({ shown: [1], more: 0 });
  });
});

describe("togglePending", () => {
  it("marks a new visibility, and clears it on the same choice or the saved one", () => {
    let p: Pending = {};
    p = togglePending(p, 1, "public", "private", "/a.png");
    expect(p).toEqual({ 1: { to: "public", from: "private", file: "/a.png" } });
    // Another choice replaces it.
    p = togglePending(p, 1, "unlisted", "private", "/a.png");
    expect(p[1].to).toBe("unlisted");
    // The same choice again clears it.
    expect(togglePending(p, 1, "unlisted", "private", "/a.png")).toEqual({});
    // So does choosing what is saved.
    expect(togglePending(p, 1, "private", "private", "/a.png")).toEqual({});
    // Choosing the saved one with nothing pending: nothing.
    expect(togglePending({}, 2, "public", "public", "/b.png")).toEqual({});
  });
});

const pending: Pending = {
  3: { to: "public", from: "private", file: "/c.png" },
  1: { to: "private", from: "public", file: "/a.png" },
  2: { to: "public", from: "unlisted", file: "/b.png" },
  4: { to: "unlisted", from: "private", file: "/d.png" },
};

describe("pendingCounts / exposing", () => {
  it("counts by the new visibility", () => {
    expect(pendingCounts(pending)).toEqual({
      private: 1,
      unlisted: 1,
      public: 2,
    });
  });

  it("lists the photos that become visible to others", () => {
    expect(exposing(pending).map(([id]) => id)).toEqual([2, 3, 4]);
  });
});

describe("pendingBatches", () => {
  it("groups by visibility and caps each batch", () => {
    expect(pendingBatches(pending, 100)).toEqual([
      { visibility: "private", ids: [1] },
      { visibility: "unlisted", ids: [4] },
      { visibility: "public", ids: [2, 3] },
    ]);
    expect(pendingBatches(pending, 1)).toEqual([
      { visibility: "private", ids: [1] },
      { visibility: "unlisted", ids: [4] },
      { visibility: "public", ids: [2] },
      { visibility: "public", ids: [3] },
    ]);
  });
});

describe("parsePending / pendingKey", () => {
  it("round-trips through JSON and drops malformed entries", () => {
    expect(parsePending(JSON.stringify(pending))).toEqual(pending);
    expect(
      parsePending(
        JSON.stringify({
          1: { to: "public", from: "private", file: "/a.png" },
          x: { to: "public", from: "private", file: "/b.png" },
          2: { to: "everyone", from: "private", file: "/c.png" },
          3: { to: "public", from: "private" },
        }),
      ),
    ).toEqual({ 1: { to: "public", from: "private", file: "/a.png" } });
    expect(parsePending(null)).toEqual({});
    expect(parsePending("not json")).toEqual({});
  });

  it("keys the storage by list, whatever its page", () => {
    expect(pendingKey("/media/?view=files&dir=%2Fa")).toBe(
      "admin-review-pending:/media/?view=files&dir=%2Fa",
    );
    expect(pendingKey("/media/?view=files&dir=%2Fa&page=2")).toBe(
      pendingKey("/media/?view=files&dir=%2Fa"),
    );
    expect(pendingKey("/media/?page=3")).toBe("admin-review-pending:/media/");
  });
});
