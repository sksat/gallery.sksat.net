import { describe, expect, it } from "vitest";
import {
  parseTagList,
  renameInList,
  unrenameInList,
  validateTagName,
} from "./tag-rename";

describe("validateTagName", () => {
  it("trims, and refuses empty, long and comma names", () => {
    expect(validateTagName("  旅 ")).toEqual({ ok: true, value: "旅" });
    expect(validateTagName("  ").ok).toBe(false);
    expect(validateTagName("a".repeat(201)).ok).toBe(false);
    expect(validateTagName("a,b").ok).toBe(false);
  });
});

describe("renameInList", () => {
  it("renames in place, and leaves lists without it alone", () => {
    expect(renameInList(["a", "旅", "b"], "旅", "旅行")).toEqual([
      "a",
      "旅行",
      "b",
    ]);
    const none = ["a"];
    expect(renameInList(none, "旅", "旅行")).toBe(none);
  });

  it("merges: the old name goes where the new one is already", () => {
    expect(renameInList(["旅", "a", "旅行"], "旅", "旅行")).toEqual([
      "a",
      "旅行",
    ]);
  });
});

describe("unrenameInList", () => {
  const cases: [string[], string, string][] = [
    [["a", "旅", "b"], "旅", "旅行"],
    [["旅", "a", "旅行"], "旅", "旅行"],
    [["旅行", "旅"], "旅", "旅行"],
  ];
  it.each(cases)("restores %j exactly when untouched", (before, from, to) => {
    expect(
      unrenameInList(renameInList(before, from, to), before, from, to),
    ).toEqual(before);
  });

  it("keeps an edit made since, taking back only the rename", () => {
    // Renamed, then "c" added.
    expect(
      unrenameInList(["a", "旅行", "c"], ["a", "旅"], "旅", "旅行"),
    ).toEqual(["a", "旅", "c"]);
    // Merged, then "c" added: 旅 back at its place, 旅行 stays.
    expect(
      unrenameInList(["a", "旅行", "c"], ["旅", "a", "旅行"], "旅", "旅行"),
    ).toEqual(["旅", "a", "旅行", "c"]);
    // The new name taken off since: nothing to take back.
    expect(unrenameInList(["a"], ["a", "旅"], "旅", "旅行")).toEqual(["a"]);
  });
});

describe("parseTagList", () => {
  it("reads string arrays only", () => {
    expect(parseTagList('["a"]')).toEqual(["a"]);
    expect(parseTagList("[1]")).toBeNull();
    expect(parseTagList("{")).toBeNull();
    expect(parseTagList(null)).toBeNull();
  });
});
