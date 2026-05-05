import { describe, expect, it } from "vitest";
import { parseTagsInput, validatePatch } from "./validate";

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

  it("converts empty camera strings to null when both are present", () => {
    const r = validatePatch({ camera_make: "", camera_model: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.camera_make).toBeNull();
      expect(r.patch.camera_model).toBeNull();
    }
  });

  it("rejects patching camera_make without camera_model", () => {
    const r = validatePatch({ camera_make: "Canon" });
    expect(r.ok).toBe(false);
  });

  it("rejects mixed null/non-null camera fields", () => {
    const r = validatePatch({ camera_make: "Canon", camera_model: null });
    expect(r.ok).toBe(false);
  });

  it("trims whitespace from non-empty camera values", () => {
    const r = validatePatch({
      camera_make: "  Canon  ",
      camera_model: "\tEOS\n",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.camera_make).toBe("Canon");
      expect(r.patch.camera_model).toBe("EOS");
    }
  });

  it("rejects array body", () => {
    const r = validatePatch([]);
    expect(r.ok).toBe(false);
  });

  it("rejects camera fields longer than 200 chars", () => {
    const long = "a".repeat(201);
    const r = validatePatch({ camera_make: long, camera_model: long });
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
