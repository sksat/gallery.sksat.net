import { describe, expect, it } from "vitest";
import {
  cameraHref,
  cameraLabel,
  cameraSlug,
  cameraSlugFromPath,
  camerasFromMedia,
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
        make: "logilabo",
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
          make: "",
          images: "nope",
        },
      ]),
    ).toEqual([
      {
        slug: "a",
        name: "A",
        make: null,
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
        make: null,
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
    make: "logilabo",
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
