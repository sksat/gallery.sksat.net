import { describe, expect, it } from "vitest";
import {
  parseChoiceMap,
  parseTagList,
  renameInChoices,
  renameInList,
  storedChoiceMap,
  unrenameInChoices,
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

describe("renameInChoices / unrenameInChoices (0021)", () => {
  const H = "hidden";

  it("moves the choice to the new name, in place", () => {
    const c = { a: H, 旅: H, b: H };
    expect(JSON.stringify(renameInChoices(c, "旅", "たび"))).toBe(
      '{"a":"hidden","たび":"hidden","b":"hidden"}',
    );
    const none = { a: H };
    expect(renameInChoices(none, "旅", "たび")).toBe(none);
  });

  it("merges: hidden when either was", () => {
    expect(renameInChoices({ 旅: H, 旅行: "shown" }, "旅", "旅行")).toEqual({
      旅行: H,
    });
    expect(renameInChoices({ 旅: "shown", 旅行: H }, "旅", "旅行")).toEqual({
      旅行: H,
    });
  });

  it("undoes exactly while nothing changed since", () => {
    const before = { 旅: H, 旅行: "shown" };
    const after = renameInChoices(before, "旅", "旅行");
    expect(unrenameInChoices(after, before, "旅", "旅行")).toBe(before);
  });

  it("keeps a choice made since, hiding the old name when the new one is", () => {
    // Renamed with no choice; hidden since under the new name.
    expect(unrenameInChoices({ たび: H }, {}, "旅", "たび")).toEqual({
      たび: H,
      旅: H,
    });
    // Hidden by the rename, shown since: `from` back as it was (none),
    // and the edit stays.
    expect(unrenameInChoices({}, { 旅: "x" }, "旅", "たび")).toEqual({
      旅: "x",
    });
  });

  it("parses and stores", () => {
    expect(parseChoiceMap('{"a":"hidden","b":1,"c":null,"d":"shown"}')).toEqual({ a: H, b: H, d: "shown" });
    expect(parseChoiceMap("[]")).toBeNull();
    expect(parseChoiceMap(null)).toBeNull();
    expect(storedChoiceMap({})).toBeNull();
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
