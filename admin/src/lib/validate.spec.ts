import { describe, expect, it } from "vitest";
import {
  cameraImagePathLengthError,
  MAX_IMAGE_FILE_LEN,
  parseCameraIdInput,
  parseTagsInput,
  validateCamera,
  validateCameraImage,
  validateImageFile,
  resolveCameraImagePath,
  validateBulkVisibility,
  validateRestoreVisibility,
  validatePatch,
} from "./validate";

describe("validatePatch tag fields", () => {
  it("takes field ids to values / levels, null clearing", () => {
    expect(
      validatePatch({
        tag_values: { 1: "Portra", 2: 400, 3: null },
        tag_value_visibility: { 2: "hidden", 3: null },
      }),
    ).toEqual({
      ok: true,
      patch: {
        tag_values: { 1: "Portra", 2: 400, 3: null },
        tag_value_visibility: { 2: "hidden", 3: null },
      },
    });
  });

  it("refuses other shapes", () => {
    for (const bad of [
      { tag_values: [] },
      { tag_values: { iso: 1 } },
      { tag_values: { 0: "a" } },
      { tag_values: { 1: { nested: true } } },
      { tag_values: { 1: Number.NaN } },
      { tag_values: { 1: "a".repeat(401) } },
      { tag_value_visibility: { 1: "public" } },
      {
        tag_values: Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [i + 1, "a"]),
        ),
      },
    ]) {
      expect(validatePatch(bad).ok, JSON.stringify(bad).slice(0, 60)).toBe(
        false,
      );
    }
  });
});

describe("validatePatch visibility", () => {
  it("accepts each visibility", () => {
    for (const v of ["private", "unlisted", "public"]) {
      const r = validatePatch({ visibility: v });
      expect(r).toEqual({ ok: true, patch: { visibility: v } });
    }
  });

  it("rejects anything else", () => {
    expect(validatePatch({ visibility: "hidden" }).ok).toBe(false);
    expect(validatePatch({ visibility: null }).ok).toBe(false);
  });
});

describe("cameraImagePathLengthError", () => {
  const prefix = "/camera/vl2/".length;

  it("counts the folder a bare name goes in", () => {
    const fits = "a".repeat(MAX_IMAGE_FILE_LEN - prefix - 4) + ".png";
    expect(cameraImagePathLengthError(fits, "vl2")).toBeNull();
    expect(cameraImagePathLengthError(`x${fits}`, "vl2")).toBe(
      `With /camera/vl2/ in front, the path is ${MAX_IMAGE_FILE_LEN + 1} characters; at most ${MAX_IMAGE_FILE_LEN}.`,
    );
  });

  it("measures an absolute path as is", () => {
    const path = "/" + "a".repeat(MAX_IMAGE_FILE_LEN - 5) + ".png";
    expect(cameraImagePathLengthError(path, "vl2")).toBeNull();
    expect(cameraImagePathLengthError(`/a${path}`, "vl2")).toBe(
      `The path is ${MAX_IMAGE_FILE_LEN + 2} characters; at most ${MAX_IMAGE_FILE_LEN}.`,
    );
  });
});

describe("resolveCameraImagePath", () => {
  it("puts a bare file name in the camera's folder", () => {
    expect(resolveCameraImagePath(" front.png ", "vl2")).toBe(
      "/camera/vl2/front.png",
    );
    expect(resolveCameraImagePath("sub/a.png", "vl2")).toBe(
      "/camera/vl2/sub/a.png",
    );
  });

  it("keeps an absolute path and an empty input", () => {
    expect(resolveCameraImagePath("/other/a.png", "vl2")).toBe("/other/a.png");
    expect(resolveCameraImagePath("  ", "vl2")).toBe("");
  });
});

describe("validateRestoreVisibility", () => {
  it("groups ids by their previous visibility", () => {
    expect(
      validateRestoreVisibility(
        [
          { id: 3, visibility: "public" },
          { id: 1, visibility: "private" },
          { id: 2, visibility: "public" },
          { id: 3, visibility: "unlisted" },
        ],
        100,
      ),
    ).toEqual({
      ok: true,
      groups: [
        { visibility: "private", ids: [1] },
        { visibility: "public", ids: [3, 2] },
      ],
    });
  });

  it("rejects empty, malformed and oversized input", () => {
    expect(validateRestoreVisibility([], 100).ok).toBe(false);
    expect(validateRestoreVisibility("x", 100).ok).toBe(false);
    expect(
      validateRestoreVisibility([{ id: "1", visibility: "public" }], 100).ok,
    ).toBe(false);
    expect(
      validateRestoreVisibility([{ id: 1, visibility: "secret" }], 100).ok,
    ).toBe(false);
    expect(
      validateRestoreVisibility(
        [
          { id: 1, visibility: "public" },
          { id: 2, visibility: "public" },
        ],
        1,
      ),
    ).toEqual({ ok: false, error: "at most 1 photos at a time" });
  });
});

describe("validateBulkVisibility", () => {
  it("parses form ids and deduplicates them", () => {
    expect(
      validateBulkVisibility(
        { ids: ["3", "1", "3"], visibility: "unlisted" },
        100,
      ),
    ).toEqual({ ok: true, ids: [3, 1], visibility: "unlisted" });
  });

  it("accepts a single id (one checkbox submits a string)", () => {
    expect(
      validateBulkVisibility({ ids: "7", visibility: "public" }, 100),
    ).toEqual({ ok: true, ids: [7], visibility: "public" });
  });

  it("rejects no selection, bad ids, too many ids and bad visibility", () => {
    const bad = [
      { ids: [], visibility: "public" },
      { ids: undefined, visibility: "public" },
      { ids: ["0"], visibility: "public" },
      { ids: ["1.5"], visibility: "public" },
      { ids: ["-1"], visibility: "public" },
      { ids: ["1"], visibility: "secret" },
    ];
    for (const input of bad) {
      expect(validateBulkVisibility(input, 100).ok).toBe(false);
    }
    expect(
      validateBulkVisibility({ ids: ["1", "2", "3"], visibility: "public" }, 2)
        .ok,
    ).toBe(false);
  });
});

describe("validatePatch", () => {
  it("accepts a partial patch with only tags", () => {
    const r = validatePatch({ tags: ["a", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch).toEqual({ tags: ["a", "b"] });
  });

  it("trims and drops empty tags", () => {
    const r = validatePatch({ tags: [" a ", "", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.tags).toEqual(["a", "b"]);
  });

  it("deduplicates tags, preserving first-seen order", () => {
    const r = validatePatch({ tags: ["a", "b", "a", " a ", "c", "b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.tags).toEqual(["a", "b", "c"]);
  });

  it("rejects non-string tag entries", () => {
    const r = validatePatch({ tags: ["a", 1] });
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed platform key", () => {
    expect(validatePatch({ platform: "Neos VR" }).ok).toBe(false);
    expect(validatePatch({ platform: "" }).ok).toBe(false);
    expect(validatePatch({ platform: 1 }).ok).toBe(false);
    // Any key of the right shape: D1 checks it exists.
    expect(validatePatch({ platform: "Neos-VR" }).ok).toBe(true);
  });

  it("takes the platform; world is not the platform", () => {
    const r = validatePatch({ platform: "VRChat" });
    expect(r.ok && r.patch).toEqual({ platform: "VRChat" });
    expect(validatePatch({ world: "Real" })).toEqual({
      ok: false,
      error: "unknown field: world",
    });
  });

  it('takes metadata visibility overrides; "" is the default', () => {
    const r = validatePatch({
      metadata_visibility: { taken_at: "date", camera: "", file_name: "path" },
    });
    expect(r.ok && r.patch).toEqual({
      metadata_visibility: { taken_at: "date", file_name: "path" },
    });
    expect(validatePatch({ metadata_visibility: { tags: "all" } }).ok).toBe(
      false,
    );
    expect(validatePatch({ metadata_visibility: { colour: "red" } }).ok).toBe(
      false,
    );
    expect(validatePatch({ metadata_visibility: "date" }).ok).toBe(false);
  });

  it("accepts a camera id and an explicit null", () => {
    const r = validatePatch({ camera_id: 3 });
    expect(r.ok && r.patch).toEqual({ camera_id: 3 });
    const n = validatePatch({ camera_id: null });
    expect(n.ok && n.patch).toEqual({ camera_id: null });
  });

  it.each([0, -1, 1.5, "3", true])("rejects camera_id %j", (camera_id) => {
    expect(validatePatch({ camera_id }).ok).toBe(false);
  });

  it("refuses the removed camera_make/camera_model fields", () => {
    // The camera is only set through camera_id.
    const r = validatePatch({ camera_make: "Canon", camera_model: "EOS" });
    expect(r.ok).toBe(false);
  });
  it("rejects array body", () => {
    const r = validatePatch([]);
    expect(r.ok).toBe(false);
  });

  it("rejects more than 100 tags", () => {
    const tags = Array.from({ length: 101 }, (_, i) => `t${i}`);
    const r = validatePatch({ tags });
    expect(r.ok).toBe(false);
  });

  it("rejects a tag longer than 200 chars", () => {
    const r = validatePatch({ tags: ["a".repeat(201)] });
    expect(r.ok).toBe(false);
  });
});

describe("parseTagsInput", () => {
  it("splits on commas and trims", () => {
    expect(parseTagsInput("a, b ,c")).toEqual(["a", "b", "c"]);
  });
  it("drops empties", () => {
    expect(parseTagsInput(",,a,,")).toEqual(["a"]);
  });
});

describe("parseCameraIdInput", () => {
  it("maps the empty option to null", () => {
    expect(parseCameraIdInput("")).toBeNull();
  });
  it("parses a positive integer id", () => {
    expect(parseCameraIdInput("12")).toBe(12);
  });
  it.each(["0", "-1", "1.5", "01", "abc", " 1", "99999999999999999999"])(
    "returns undefined for %j",
    (raw) => {
      expect(parseCameraIdInput(raw)).toBeUndefined();
    },
  );
});

describe("validateCamera", () => {
  const base = {
    slug: "virtuallens2",
    name: "VirtualLens2",
    manufacturer: "logilabo",
    manufacturer_url: "https://logilabo.booth.pm/",
    model: "VirtualLens2",
    kind: "virtual",
    description: "VRChat camera gimmick",
    product_url: "https://logilabo.booth.pm/items/2280136",
  };

  it("accepts a full record", () => {
    const r = validateCamera(base);
    expect(r.ok && r.camera).toEqual(base);
  });

  it("trims fields and turns empty optional ones into null", () => {
    const r = validateCamera({
      slug: " pentax-sp ",
      name: " PENTAX SP ",
      manufacturer: "  ",
      manufacturer_url: "",
      model: "",
      kind: "",
      description: "",
      product_url: "",
    });
    expect(r.ok && r.camera).toEqual({
      slug: "pentax-sp",
      name: "PENTAX SP",
      manufacturer: null,
      manufacturer_url: null,
      model: null,
      kind: null,
      description: null,
      product_url: null,
    });
  });

  it("treats missing optional fields as null", () => {
    const r = validateCamera({ slug: "x", name: "X" });
    expect(r.ok && r.camera).toMatchObject({
      manufacturer: null,
      manufacturer_url: null,
      kind: null,
    });
  });

  it.each([
    "",
    "VirtualLens2",
    "virtual lens",
    "-a",
    "a-",
    "a--b",
    "a_b",
    "カメラ",
    "a".repeat(65),
  ])("rejects slug %j", (slug) => {
    expect(validateCamera({ ...base, slug }).ok).toBe(false);
  });

  it("requires a name", () => {
    expect(validateCamera({ ...base, name: "  " }).ok).toBe(false);
    expect(validateCamera({ ...base, name: undefined }).ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(validateCamera({ ...base, kind: "drone" }).ok).toBe(false);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "not a url"])(
    "rejects product_url %j",
    (product_url) => {
      expect(validateCamera({ ...base, product_url }).ok).toBe(false);
    },
  );

  it.each(["javascript:alert(1)", "data:text/html,x", "not a url"])(
    "rejects manufacturer_url %j",
    (manufacturer_url) => {
      expect(validateCamera({ ...base, manufacturer_url }).ok).toBe(false);
    },
  );

  it("rejects over-long fields", () => {
    expect(
      validateCamera({
        ...base,
        product_url: `https://example.com/${"a".repeat(2000)}`,
      }).ok,
    ).toBe(false);
    expect(validateCamera({ ...base, name: "a".repeat(201) }).ok).toBe(false);
    expect(validateCamera({ ...base, model: "a".repeat(201) }).ok).toBe(false);
    expect(validateCamera({ ...base, description: "a".repeat(2001) }).ok).toBe(
      false,
    );
  });

  it("rejects non-string optional fields", () => {
    expect(validateCamera({ ...base, manufacturer: 1 }).ok).toBe(false);
  });
});

describe("validateImageFile", () => {
  it.each([
    "/camera/virtuallens2/front.png",
    "/camera/pentax-sp/front_1.JPG",
    "/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png",
    "/a.jpeg",
  ])("accepts %j", (file) => {
    expect(validateImageFile(file)).toEqual({ ok: true, file });
  });

  it("trims surrounding whitespace", () => {
    expect(validateImageFile("  /a.png ")).toEqual({
      ok: true,
      file: "/a.png",
    });
  });

  it.each([
    "",
    "camera/a.png",
    "/camera/../secret.png",
    "/camera/./a.png",
    "//a.png",
    "/camera/a b.png",
    "/camera/a.png?x=1",
    "/camera/a%2e.png",
    "/camera/a.gif",
    "/camera/a",
    "/camera/",
    "https://evil.example/a.png",
    `/${"a".repeat(500)}.png`,
  ])("rejects %j", (file) => {
    expect(validateImageFile(file).ok).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(validateImageFile(undefined).ok).toBe(false);
  });
});

describe("validateCameraImage", () => {
  it("normalises an empty caption to null", () => {
    expect(validateCameraImage({ file: "/a.png", caption: " " })).toEqual({
      ok: true,
      image: { file: "/a.png", caption: null },
    });
  });

  it("rejects an over-long caption", () => {
    expect(
      validateCameraImage({ file: "/a.png", caption: "a".repeat(201) }).ok,
    ).toBe(false);
  });
});
