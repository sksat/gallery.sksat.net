import { describe, expect, it } from "vitest";
import { rowToMedia, rowToMediaJson } from "./db";

describe("rowToMedia", () => {
  it("parses tags JSON and preserves nullable fields", () => {
    const row = rowToMedia({
      id: 1,
      file: "/VRChat/2023-12/x.png",
      world: "VRChat",
      timestamp: "2023-12-11T01:21:32.519+09:00",
      camera_make: "logilabo",
      camera_model: "VirtualLens2",
      tags: '["VRChat","portrait"]',
      updated_at: "2025-05-03T10:00:00.000Z",
    });
    expect(row.tags).toEqual(["VRChat", "portrait"]);
    expect(row.camera_make).toBe("logilabo");
    expect(row.timestamp).toBe("2023-12-11T01:21:32.519+09:00");
  });

  it("handles empty tags and missing camera", () => {
    const row = rowToMedia({
      id: 2,
      file: "/Real/x.jpg",
      world: "Real",
      timestamp: null,
      camera_make: null,
      camera_model: null,
      tags: "[]",
      updated_at: "2025-05-03T10:00:00.000Z",
    });
    expect(row.tags).toEqual([]);
    expect(row.camera_make).toBeNull();
  });

  it("rejects unknown world value", () => {
    expect(() =>
      rowToMedia({
        id: 3,
        file: "x",
        world: "Mars",
        timestamp: null,
        camera_make: null,
        camera_model: null,
        tags: "[]",
        updated_at: "2025-05-03T10:00:00.000Z",
      }),
    ).toThrow(/unknown world/);
  });

  it("rejects malformed tags JSON", () => {
    expect(() =>
      rowToMedia({
        id: 4,
        file: "x",
        world: "Real",
        timestamp: null,
        camera_make: null,
        camera_model: null,
        tags: "[1,2,3]",
        updated_at: "2025-05-03T10:00:00.000Z",
      }),
    ).toThrow(/tags column/);
  });
});

describe("rowToMediaJson", () => {
  it("collapses make+model into camera object", () => {
    const json = rowToMediaJson({
      id: 1,
      file: "/x.png",
      world: "VRChat",
      timestamp: null,
      camera_make: "logilabo",
      camera_model: "VirtualLens2",
      tags: ["VRChat"],
      updated_at: "2025-05-03T10:00:00.000Z",
    });
    expect(json).toEqual({
      file: "/x.png",
      world: "VRChat",
      timestamp: null,
      camera: { make: "logilabo", model: "VirtualLens2" },
      tags: ["VRChat"],
    });
  });

  it("returns null camera when either part is missing", () => {
    const json = rowToMediaJson({
      id: 1,
      file: "/x.png",
      world: "Real",
      timestamp: null,
      camera_make: null,
      camera_model: "VirtualLens2",
      tags: [],
      updated_at: "2025-05-03T10:00:00.000Z",
    });
    expect(json.camera).toBeNull();
  });
});
