import { describe, expect, it } from "vitest";
import {
  buildExport,
  reorderedIds,
  rowToCamera,
  rowToMedia,
  rowToMediaJson,
} from "./db";
import type { CameraRow, MediaRow } from "./types";

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

const film: CameraRow = {
  id: 2,
  slug: "pentax-sp",
  name: "PENTAX SP",
  manufacturer: null,
  manufacturer_url: null,
  model: null,
  kind: "film",
  description: "35mm SLR",
  product_url: "https://example.com/sp",
  updated_at: UPDATED,
};

const media = (over: Partial<MediaRow>): MediaRow => ({
  id: 1,
  file: "/x.png",
  world: "VRChat",
  timestamp: null,
  camera_id: null,
  tags: [],
  updated_at: UPDATED,
  ...over,
});

describe("rowToMedia", () => {
  it("parses tags JSON and preserves nullable fields", () => {
    const row = rowToMedia({
      id: 1,
      file: "/VRChat/2023-12/x.png",
      world: "VRChat",
      timestamp: "2023-12-11T01:21:32.519+09:00",
      camera_id: 4,
      tags: '["VRChat","portrait"]',
      updated_at: UPDATED,
    });
    expect(row.tags).toEqual(["VRChat", "portrait"]);
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
      updated_at: UPDATED,
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
        updated_at: UPDATED,
      }),
    ).toThrow(/unknown world/);
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
        updated_at: UPDATED,
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
        updated_at: UPDATED,
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

describe("rowToMediaJson", () => {
  const cameras = new Map([
    [vl2.id, vl2],
    [film.id, film],
  ]);

  it("embeds the manufacturer as the legacy make, plus slug and name", () => {
    const json = rowToMediaJson(
      media({ camera_id: 1, tags: ["VRChat"] }),
      cameras,
    );
    expect(json).toEqual({
      file: "/x.png",
      world: "VRChat",
      timestamp: null,
      camera: {
        make: "logilabo",
        model: "VirtualLens2",
        slug: "virtuallens2",
        name: "VirtualLens2",
      },
      tags: ["VRChat"],
    });
  });

  it("keeps make/model strings for a camera without them (old readers)", () => {
    const json = rowToMediaJson(media({ camera_id: 2 }), cameras);
    expect(json.camera).toEqual({
      make: "",
      model: "PENTAX SP",
      slug: "pentax-sp",
      name: "PENTAX SP",
    });
  });

  it("returns a null camera when the photo has none", () => {
    expect(rowToMediaJson(media({}), cameras).camera).toBeNull();
  });

  it("throws on a dangling camera_id instead of dropping the camera", () => {
    expect(() => rowToMediaJson(media({ camera_id: 99 }), cameras)).toThrow(
      /missing camera 99/,
    );
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

describe("buildExport", () => {
  it("keeps media order and sorts cameras by slug, without admin fields", () => {
    const out = buildExport(
      [media({ id: 2, file: "/b.png" }), media({ id: 1, camera_id: 1 })],
      [vl2, film],
      [
        { id: 7, camera_id: 1, file: "/c/b.png", position: 1, caption: null },
        { id: 9, camera_id: 1, file: "/c/a.png", position: 0, caption: "A" },
      ],
    );
    expect(out.media.map((m) => m.file)).toEqual(["/b.png", "/x.png"]);
    expect(out.cameras).toEqual([
      {
        slug: "pentax-sp",
        name: "PENTAX SP",
        manufacturer: null,
        manufacturerUrl: null,
        model: null,
        kind: "film",
        description: "35mm SLR",
        productUrl: "https://example.com/sp",
        images: [],
      },
      {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        manufacturerUrl: "https://logilabo.booth.pm/",
        model: "VirtualLens2",
        kind: "virtual",
        description: null,
        productUrl: null,
        images: [
          { file: "/c/a.png", caption: "A" },
          { file: "/c/b.png", caption: null },
        ],
      },
    ]);
  });

  it("returns cameras with an empty images list when none are given", () => {
    expect(buildExport([], [vl2]).cameras[0].images).toEqual([]);
  });

  it("is a plain JSON array per file (media.json stays an array)", () => {
    const out = buildExport([], []);
    expect(Array.isArray(out.media)).toBe(true);
    expect(Array.isArray(out.cameras)).toBe(true);
  });
});
