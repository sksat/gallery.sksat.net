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
import type { CameraJSON, MediaCamera, MediaInfo } from "./types";

const photo = (camera: MediaInfo["camera"]): MediaInfo => ({
  id: "abcdefghjk",
  file: "/x.png",
  world: "VRChat",
  timestamp: null,
  camera,
  tags: [],
});

const vl2: MediaCamera = {
  slug: "virtuallens2",
  name: "VirtualLens2",
  manufacturer: "logilabo",
  model: "VirtualLens2",
};

describe("cameraSlug", () => {
  it("uses the camera's slug", () => {
    expect(cameraSlug({ ...vl2, slug: "vl2" })).toBe("vl2");
  });
});

describe("cameraLabel", () => {
  it("prefers the name, else manufacturer + model, else the slug", () => {
    expect(cameraLabel(vl2)).toBe("VirtualLens2");
    expect(cameraLabel({ ...vl2, name: "" })).toBe("logilabo VirtualLens2");
    expect(
      cameraLabel({ slug: "x", name: "", manufacturer: null, model: null }),
    ).toBe("x");
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
    expect(camerasFromMedia([photo(vl2), photo(null), photo(vl2)])).toEqual([
      {
        slug: "virtuallens2",
        name: "VirtualLens2",
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
            { file: "/cameras/a.png", caption: "Front" },
            { file: "/cameras/../x.png" },
            { file: "/cameras/b.jpg" },
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
          { file: "/cameras/a.png", caption: "Front" },
          { file: "/cameras/b.jpg", caption: null },
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
  it.each(["/cameras/a.png", "/a/b_c-d.1.JPG", "/x.jpeg"])(
    "accepts %j",
    (p) => {
      expect(isImagePath(p)).toBe(true);
    },
  );

  it.each([
    "cameras/a.png",
    "/cameras/../a.png",
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

  it("prefers the camera record", () => {
    expect(findCamera([published], [photo(vl2)], "virtuallens2")).toBe(
      published,
    );
  });

  it("falls back to the photos without a record", () => {
    expect(findCamera(null, [photo(vl2)], "virtuallens2")?.name).toBe(
      "VirtualLens2",
    );
  });

  it("returns null for an unknown slug", () => {
    expect(findCamera([published], [photo(vl2)], "nope")).toBeNull();
  });
});

describe("takenWith", () => {
  it("matches the photo's camera by slug", () => {
    expect(takenWith(photo(vl2), "virtuallens2")).toBe(true);
    expect(takenWith(photo(null), "virtuallens2")).toBe(false);
    expect(takenWith(photo(vl2), "pentax-sp")).toBe(false);
  });
});

describe("cameraSummaries", () => {
  const at = (
    id: string,
    camera: MediaInfo["camera"],
    iso: string | null,
  ): MediaInfo => ({
    id,
    file: `/${id}.png`,
    world: "VRChat",
    timestamp: iso === null ? null : new Date(iso),
    camera,
    tags: [],
  });
  const sp: MediaCamera = {
    slug: "pentax-sp",
    name: "PENTAX SP",
    manufacturer: "Asahi",
    model: "Pentax SP",
  };
  const a1: MediaCamera = {
    slug: "a1",
    name: "A1",
    manufacturer: "A",
    model: "A1",
  };
  const media = [
    at("vxxxxxxxxa", vl2, "2023-12-01T00:00:00Z"),
    at("vxxxxxxxxb", vl2, "2023-12-05T00:00:00Z"),
    at("vxxxxxxxxc", vl2, null),
    at("spxxxxxxxx", sp, "2023-12-02T00:00:00Z"),
    at("axxxxxxxxx", a1, null),
    at("nxxxxxxxxx", null, "2023-12-03T00:00:00Z"),
  ];
  const blank: CameraJSON = {
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
  const published: CameraJSON[] = [
    {
      ...blank,
      slug: "pentax-sp",
      name: "PENTAX SP",
      manufacturer: "Asahi",
      model: "Pentax SP",
      kind: "film",
      images: [{ file: "/cameras/sp.png", caption: null }],
    },
    // No photos: left out of the list.
    { ...blank, slug: "unused", name: "Unused" },
  ];

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
    expect(cover("pentax-sp")).toBe("/cameras/sp.png");
    expect(cover("virtuallens2")).toEqual({
      id: "vxxxxxxxxb",
      file: "/vxxxxxxxxb.png",
    });
    expect(cover("a1")).toEqual({ id: "axxxxxxxxx", file: "/axxxxxxxxx.png" });
  });

  it("falls back to the photos for the camera details", () => {
    const list = cameraSummaries(media, null);
    expect(
      list.find((s) => s.camera.slug === "pentax-sp")?.camera,
    ).toMatchObject({ name: "PENTAX SP", manufacturer: "Asahi", images: [] });
  });
});
