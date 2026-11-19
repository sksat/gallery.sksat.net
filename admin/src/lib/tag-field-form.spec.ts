import { describe, expect, it } from "vitest";
import type { TagFieldDef } from "@shared/tag-field/tag-field";
import { tagFieldFormValues, tagFieldPatch } from "./tag-field-form";

const fields: TagFieldDef[] = [
  {
    id: 1,
    tag: "フィルム",
    label: "銘柄",
    type: "text",
    options: null,
    visibility: "shown",
    position: 0,
  },
  {
    id: 2,
    tag: "フィルム",
    label: "ISO",
    type: "number",
    options: null,
    visibility: "shown",
    position: 1,
  },
];

describe("tagFieldFormValues", () => {
  it("gives each field its stored value and own level as text", () => {
    expect(
      tagFieldFormValues(
        {
          tag_values: { 1: "Portra", 2: "not a number", 9: "other" },
          tag_value_visibility: { 2: "hidden" },
        },
        fields,
      ),
    ).toEqual({
      values: { f1: "Portra", f2: "" },
      levels: { f1: "", f2: "hidden" },
    });
  });
});

describe("tagFieldPatch", () => {
  const loaded = JSON.stringify({
    values: { f1: "Portra", f2: "400" },
    levels: { f1: "", f2: "" },
  });

  it("sends only what changed", () => {
    expect(
      tagFieldPatch(
        loaded,
        { f1: "Portra ", f2: "800" },
        { f1: "", f2: "hidden" },
      ),
    ).toEqual({
      tag_values: { 2: "800" },
      tag_value_visibility: { 2: "hidden" },
    });
    expect(tagFieldPatch(loaded, { f1: "" }, { f2: "" })).toEqual({
      tag_values: { 1: null },
    });
    expect(
      tagFieldPatch(
        JSON.stringify({ values: { f1: "" }, levels: { f1: "shown" } }),
        {},
        { f1: "" },
      ),
    ).toEqual({ tag_value_visibility: { 1: null } });
  });

  it("ignores inputs the page did not load, and malformed state", () => {
    expect(tagFieldPatch(loaded, { f3: "x", "1": "y" }, undefined)).toEqual({});
    expect(tagFieldPatch(undefined, { f1: "x" }, undefined)).toEqual({});
    expect(tagFieldPatch("{", { f1: "x" }, undefined)).toEqual({});
    expect(tagFieldPatch("null", { f1: "x" }, undefined)).toEqual({});
  });
});
