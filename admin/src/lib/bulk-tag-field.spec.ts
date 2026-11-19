import { describe, expect, it } from "vitest";
import type { TagFieldDef } from "@shared/tag-field/tag-field";
import { bulkTagChange, sharedFields, tagsWithFields } from "./bulk-tag-field";

const def = (id: number, tag: string, label: string): TagFieldDef => ({
  id,
  tag,
  label,
  type: id === 2 ? "number" : "text",
  options: null,
  visibility: "shown",
  position: id,
});
const fields = [
  def(1, "フィルム", "銘柄"),
  def(2, "フィルム", "ISO"),
  def(3, "旅行", "行き先"),
];

const photos = [
  { id: 1, tags: ["フィルム"], values: { 1: "Portra", 2: 400 } },
  { id: 2, tags: ["フィルム", "夜"], values: { 1: "HP5", 2: 400 } },
  { id: 3, tags: ["夜"], values: {} },
];

describe("tagsWithFields", () => {
  it("lists the tags that have fields, once, in order", () => {
    expect(
      tagsWithFields(
        [
          ["夜", "旅行"],
          ["フィルム", "旅行"],
        ],
        fields,
      ),
    ).toEqual(["旅行", "フィルム"]);
  });
});

describe("sharedFields", () => {
  it("gives each field the shared value or null, over the photos with its tag", () => {
    expect(
      sharedFields(photos, fields).map((s) => [
        s.field.label,
        s.count,
        s.value,
      ]),
    ).toEqual([
      ["銘柄", 2, null],
      ["ISO", 2, "400"],
    ]);
  });
});

describe("bulkTagChange", () => {
  const shared = sharedFields(photos, fields);

  it("sends only touched fields", () => {
    // Mixed and left empty: untouched; shared and unchanged: untouched.
    expect(bulkTagChange(shared, { 1: "", 2: "400" }, [])).toEqual({});
    expect(bulkTagChange(shared, { 1: "Tri-X", 2: "800" }, [])).toEqual({
      1: "Tri-X",
      2: "800",
    });
  });

  it("clears a shared value emptied, and a mixed one with ×", () => {
    expect(bulkTagChange(shared, { 1: "", 2: "" }, [])).toEqual({ 2: null });
    expect(bulkTagChange(shared, { 1: "", 2: "400" }, [1])).toEqual({
      1: null,
    });
  });
});
