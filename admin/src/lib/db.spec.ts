import { describe, expect, it } from "vitest";
import { movedTo, reorderedIds, rowToCamera, rowToMedia } from "./db";
import type { CameraRow } from "./types";

const UPDATED = "2025-05-03T10:00:00.000Z";

const vl2: CameraRow = {
  id: 1,
  slug: "virtuallens2",
  name: "VirtualLens2",
  manufacturer: "logilabo",
  manufacturer_url: "https://logilabo.booth.pm/",
  model: "VirtualLens2",
  kind: "virtual",
  description: null,
  product_url: null,
  updated_at: UPDATED,
};

// Columns added by 0003_visibility.sql, for raw rows.
const NEW_COLS = {
  public_id: "abcdefghjk",
  visibility: "unlisted",
  legacy_index: 3,
  updated_at: UPDATED,
};

describe("rowToMedia", () => {
  it("parses tags JSON and preserves nullable fields", () => {
    const row = rowToMedia({
      id: 1,
      file: "/VRChat/2023-12/x.png",
      world: "VRChat",
      timestamp: "2023-12-11T01:21:32.519+09:00",
      camera_id: 4,
      tags: '["VRChat","portrait"]',
      ...NEW_COLS,
    });
    expect(row.tags).toEqual(["VRChat", "portrait"]);
    expect(row.public_id).toBe("abcdefghjk");
    expect(row.visibility).toBe("unlisted");
    expect(row.legacy_index).toBe(3);
    expect(row.camera_id).toBe(4);
    expect(row.timestamp).toBe("2023-12-11T01:21:32.519+09:00");
  });

  it("handles empty tags and missing camera", () => {
    const row = rowToMedia({
      id: 2,
      file: "/Real/x.jpg",
      world: "Real",
      timestamp: null,
      camera_id: null,
      tags: "[]",
      ...NEW_COLS,
    });
    expect(row.tags).toEqual([]);
    expect(row.camera_id).toBeNull();
  });

  it("rejects unknown world value", () => {
    expect(() =>
      rowToMedia({
        id: 3,
        file: "x",
        world: "Mars",
        timestamp: null,
        camera_id: null,
        tags: "[]",
        ...NEW_COLS,
      }),
    ).toThrow(/unknown world/);
  });

  it("rejects unknown visibility value", () => {
    expect(() =>
      rowToMedia({
        id: 3,
        file: "x",
        world: "Real",
        timestamp: null,
        camera_id: null,
        tags: "[]",
        ...NEW_COLS,
        visibility: "secret",
      }),
    ).toThrow(/unknown visibility/);
  });

  it("rejects a JSON array whose elements are not strings", () => {
    expect(() =>
      rowToMedia({
        id: 4,
        file: "x",
        world: "Real",
        timestamp: null,
        camera_id: null,
        tags: "[1,2,3]",
        ...NEW_COLS,
      }),
    ).toThrow(/tags column/);
  });

  it("reports invalid (non-JSON) tags column with context", () => {
    expect(() =>
      rowToMedia({
        id: 5,
        file: "x",
        world: "Real",
        timestamp: null,
        camera_id: null,
        tags: "not json",
        ...NEW_COLS,
      }),
    ).toThrow(/not valid JSON/);
  });
});

describe("rowToCamera", () => {
  it("accepts a null kind", () => {
    expect(rowToCamera({ ...vl2, kind: null }).kind).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(() => rowToCamera({ ...vl2, kind: "drone" })).toThrow(
      /unknown camera kind/,
    );
  });
});

describe("movedTo", () => {
  it("puts the id at the index", () => {
    expect(movedTo([1, 2, 3, 9], 9, 1)).toEqual([1, 9, 2, 3]);
    expect(movedTo([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
    expect(movedTo([9, 1], 9, 0)).toEqual([9, 1]);
  });

  it("clamps the index and ignores an absent id", () => {
    expect(movedTo([1, 2, 9], 9, 10)).toEqual([1, 2, 9]);
    expect(movedTo([1, 2, 9], 9, -1)).toEqual([9, 1, 2]);
    expect(movedTo([1, 2], 9, 0)).toEqual([1, 2]);
  });
});

describe("reorderedIds", () => {
  it("swaps with the neighbour", () => {
    expect(reorderedIds([1, 2, 3], 2, "up")).toEqual([2, 1, 3]);
    expect(reorderedIds([1, 2, 3], 2, "down")).toEqual([1, 3, 2]);
  });

  it("returns null at either end or for an unknown id", () => {
    expect(reorderedIds([1, 2, 3], 1, "up")).toBeNull();
    expect(reorderedIds([1, 2, 3], 3, "down")).toBeNull();
    expect(reorderedIds([1, 2, 3], 9, "up")).toBeNull();
  });
});
