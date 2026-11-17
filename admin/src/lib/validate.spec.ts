import { describe, expect, it } from "vitest";
import {
  parseCameraIdInput,
  parseTagsInput,
  validateCamera,
  validateCameraImage,
  validateImageFile,
  validatePatch,
} from "./validate";

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

  it("rejects unknown world", () => {
    const r = validatePatch({ world: "Mars" });
    expect(r.ok).toBe(false);
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

  it("ignores the removed camera_make/camera_model fields", () => {
    // Unknown keys are dropped; the camera is only set through camera_id.
    const r = validatePatch({ camera_make: "Canon", camera_model: "EOS" });
    expect(r.ok && r.patch).toEqual({});
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
    make: "logilabo",
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
      make: "  ",
      model: "",
      kind: "",
      description: "",
      product_url: "",
    });
    expect(r.ok && r.camera).toEqual({
      slug: "pentax-sp",
      name: "PENTAX SP",
      make: null,
      model: null,
      kind: null,
      description: null,
      product_url: null,
    });
  });

  it("treats missing optional fields as null", () => {
    const r = validateCamera({ slug: "x", name: "X" });
    expect(r.ok && r.camera).toMatchObject({ make: null, kind: null });
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
    expect(validateCamera({ ...base, make: 1 }).ok).toBe(false);
  });
});

describe("validateImageFile", () => {
  it.each([
    "/cameras/virtuallens2.png",
    "/cameras/pentax-sp_front.JPG",
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
    "cameras/a.png",
    "/cameras/../secret.png",
    "/cameras/./a.png",
    "//a.png",
    "/cameras/a b.png",
    "/cameras/a.png?x=1",
    "/cameras/a%2e.png",
    "/cameras/a.gif",
    "/cameras/a",
    "/cameras/",
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
