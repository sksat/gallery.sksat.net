import { describe, expect, it } from "vitest";
import {
  cameraHref,
  cameraLabel,
  cameraSlug,
  cameraSlugFromPath,
  camerasFromMedia,
  cameraSummaries,
  findCamera,
  isImagePath,
  parseCameras,
  takenWith,
} from "./cameras";
import type { CameraJSON, MediaInfo } from "./types";

const photo = (camera: MediaInfo["camera"]): MediaInfo => ({
  file: "/x.png",
  world: "VRChat",
  timestamp: null,
  camera,
  tags: [],
});

const vl2Old = { make: "logilabo", model: "VirtualLens2" };
const vl2New = { ...vl2Old, slug: "virtuallens2", name: "VirtualLens2" };

describe("cameraSlug", () => {
  it("uses the published slug", () => {
    expect(cameraSlug({ ...vl2New, slug: "vl2" })).toBe("vl2");
  });

  it("derives it from the model for an older media.json", () => {
    expect(cameraSlug(vl2Old)).toBe("virtuallens2");
    expect(cameraSlug({ make: "Canon", model: "EOS 5D Mark II" })).toBe(
      "eos-5d-mark-ii",
    );
    expect(cameraSlug({ make: "A", model: " Foo / Bar. " })).toBe("foo-bar");
  });

  it("falls back to 'camera' for a model with no usable characters", () => {
    expect(cameraSlug({ make: "X", model: "カメラ" })).toBe("camera");
  });
});

describe("cameraLabel", () => {
  it("prefers the name, else make + model", () => {
    expect(cameraLabel(vl2New)).toBe("VirtualLens2");
    expect(cameraLabel(vl2Old)).toBe("logilabo VirtualLens2");
    expect(cameraLabel({ make: "", model: "PENTAX SP" })).toBe("PENTAX SP");
  });
});

describe("cameraHref / cameraSlugFromPath", () => {
  it("round-trips a slug", () => {
    expect(cameraHref("virtuallens2")).toBe("/camera/virtuallens2/");
    expect(cameraSlugFromPath("/camera/virtuallens2/")).toBe("virtuallens2");
    expect(cameraSlugFromPath("/camera/virtuallens2")).toBe("virtuallens2");
  });

  it("ignores other paths", () => {
    expect(cameraSlugFromPath("/")).toBeNull();
    expect(cameraSlugFromPath("/photo/1")).toBeNull();
    expect(cameraSlugFromPath("/camera/")).toBeNull();
    expect(cameraSlugFromPath("/camera/a/b")).toBeNull();
    expect(cameraSlugFromPath("/camera/%E0%A4%A/")).toBeNull();
  });
});

describe("camerasFromMedia", () => {
  it("makes one minimal record per slug", () => {
    expect(
      camerasFromMedia([photo(vl2Old), photo(null), photo(vl2New)]),
    ).toEqual([
      {
        slug: "virtuallens2",
        name: "logilabo VirtualLens2",
        manufacturer: "logilabo",
        manufacturerUrl: null,
        model: "VirtualLens2",
        kind: null,
        description: null,
        productUrl: null,
        images: [],
      },
    ]);
  });
});

describe("parseCameras", () => {
  it("returns null for a non-array", () => {
    expect(parseCameras({})).toBeNull();
    expect(parseCameras(null)).toBeNull();
  });

  it("keeps valid entries and drops broken ones", () => {
    expect(
      parseCameras([
        {
          slug: "a",
          name: "A",
          kind: "film",
          manufacturer: "Asahi",
          manufacturerUrl: "https://asahi.example",
          productUrl: "https://a.example",
          images: [
            { file: "/camera/a/a.png", caption: "Front" },
            { file: "/camera/a/../x.png" },
            { file: "/camera/a/b.jpg" },
            "nope",
          ],
        },
        { slug: "b" },
        "nope",
        {
          slug: "c",
          name: "C",
          kind: "drone",
          productUrl: "javascript:alert(1)",
          manufacturer: "",
          manufacturerUrl: "data:text/html,x",
          images: "nope",
        },
      ]),
    ).toEqual([
      {
        slug: "a",
        name: "A",
        manufacturer: "Asahi",
        manufacturerUrl: "https://asahi.example",
        model: null,
        kind: "film",
        description: null,
        productUrl: "https://a.example",
        images: [
          { file: "/camera/a/a.png", caption: "Front" },
          { file: "/camera/a/b.jpg", caption: null },
        ],
      },
      {
        slug: "c",
        name: "C",
        manufacturer: null,
        manufacturerUrl: null,
        model: null,
        kind: null,
        description: null,
        productUrl: null,
        images: [],
      },
    ]);
  });
});

describe("isImagePath", () => {
  it.each(["/camera/a/a.png", "/a/b_c-d.1.JPG", "/x.jpeg"])(
    "accepts %j",
    (p) => {
      expect(isImagePath(p)).toBe(true);
    },
  );

  it.each([
    "camera/a/a.png",
    "/camera/a/../a.png",
    "/./a.png",
    "//a.png",
    "/a.png?x",
    "/a%2e.png",
    "/a.gif",
    "https://x/a.png",
    1,
  ])("rejects %j", (p) => {
    expect(isImagePath(p)).toBe(false);
  });
});

describe("findCamera", () => {
  const published: CameraJSON = {
    slug: "virtuallens2",
    name: "VirtualLens2",
    manufacturer: "logilabo",
    manufacturerUrl: null,
    model: "VirtualLens2",
    kind: "virtual",
    description: "desc",
    productUrl: null,
    images: [],
  };

  it("prefers cameras.json", () => {
    expect(findCamera([published], [photo(vl2Old)], "virtuallens2")).toBe(
      published,
    );
  });

  it("falls back to media.json without cameras.json", () => {
    expect(findCamera(null, [photo(vl2Old)], "virtuallens2")?.name).toBe(
      "logilabo VirtualLens2",
    );
  });

  it("returns null for an unknown slug", () => {
    expect(findCamera([published], [photo(vl2Old)], "nope")).toBeNull();
  });
});

describe("takenWith", () => {
  it("matches published and derived slugs alike", () => {
    expect(takenWith(photo(vl2New), "virtuallens2")).toBe(true);
    expect(takenWith(photo(vl2Old), "virtuallens2")).toBe(true);
    expect(takenWith(photo(null), "virtuallens2")).toBe(false);
    expect(takenWith(photo(vl2New), "pentax-sp")).toBe(false);
  });
});

describe("cameraSummaries", () => {
  const at = (
    file: string,
    camera: MediaInfo["camera"],
    iso: string | null,
  ): MediaInfo => ({
    file,
    world: "VRChat",
    timestamp: iso === null ? null : new Date(iso),
    camera,
    tags: [],
  });
  const sp = { make: "Asahi", model: "Pentax SP", slug: "pentax-sp", name: "PENTAX SP" };
  const a1 = { make: "A", model: "A1", slug: "a1", name: "A1" };
  const media = [
    at("/v-old.png", vl2Old, "2023-12-01T00:00:00Z"),
    at("/v-new.png", vl2New, "2023-12-05T00:00:00Z"),
    at("/v-undated.png", vl2New, null),
    at("/sp.png", sp, "2023-12-02T00:00:00Z"),
    at("/a1.png", a1, null),
    at("/none.png", null, "2023-12-03T00:00:00Z"),
  ];
  const published: CameraJSON[] = [
    {
      slug: "pentax-sp",
      name: "PENTAX SP",
      manufacturer: "Asahi",
      manufacturerUrl: null,
      model: "Pentax SP",
      kind: "film",
      description: null,
      productUrl: null,
      images: [{ file: "/camera/a/sp.png", caption: null }],
    },
    // No photos: left out of the list.
    { ...published0(), slug: "unused", name: "Unused" },
  ];

  function published0(): CameraJSON {
    return {
      slug: "",
      name: "",
      manufacturer: null,
      manufacturerUrl: null,
      model: null,
      kind: null,
      description: null,
      productUrl: null,
      images: [],
    };
  }

  it("lists cameras with photos, most photos first, then by name", () => {
    const list = cameraSummaries(media, published);
    expect(list.map((s) => [s.camera.slug, s.count])).toEqual([
      ["virtuallens2", 3],
      ["a1", 1],
      ["pentax-sp", 1],
    ]);
  });

  it("uses the first camera picture, else the newest photo, as the cover", () => {
    const list = cameraSummaries(media, published);
    const cover = (slug: string) =>
      list.find((s) => s.camera.slug === slug)?.cover;
    expect(cover("pentax-sp")).toBe("/camera/a/sp.png");
    expect(cover("virtuallens2")).toBe("/v-new.png");
    expect(cover("a1")).toBe("/a1.png");
  });

  it("falls back to media.json for the camera details", () => {
    const list = cameraSummaries(media, null);
    expect(list.find((s) => s.camera.slug === "pentax-sp")?.camera).toMatchObject(
      { name: "PENTAX SP", manufacturer: "Asahi", images: [] },
    );
  });
});
