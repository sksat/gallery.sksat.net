import { describe, expect, it } from "vitest";
import {
  formatValue,
  levelOf,
  normalizeValue,
  parseLevelMap,
  parseOptionsText,
  publicTagFields,
  readValue,
  rowToDef,
  validateFieldInput,
  type TagFieldDef,
} from "./tag-field";

const def = (
  over: Partial<TagFieldDef> & Pick<TagFieldDef, "type">,
): TagFieldDef => ({
  id: 1,
  tag: "フィルム",
  label: "銘柄",
  options: null,
  visibility: "shown",
  position: 0,
  ...over,
});

describe("validateFieldInput", () => {
  it("trims the label and takes options for a select only", () => {
    expect(
      validateFieldInput({ label: "  ISO ", type: "number", options: ["x"] }),
    ).toEqual({ ok: true, value: { label: "ISO", type: "number", options: null } });
    expect(
      validateFieldInput({
        label: "銘柄",
        type: "select",
        options: parseOptionsText("Portra 400\n\n HP5 \nPortra 400"),
      }),
    ).toEqual({
      ok: true,
      value: { label: "銘柄", type: "select", options: ["Portra 400", "HP5"] },
    });
  });

  it("refuses empty or long labels, unknown types and empty options", () => {
    expect(validateFieldInput({ label: " ", type: "text" }).ok).toBe(false);
    expect(validateFieldInput({ label: "a".repeat(41), type: "text" }).ok).toBe(
      false,
    );
    expect(validateFieldInput({ label: "a\nb", type: "text" }).ok).toBe(false);
    expect(validateFieldInput({ label: "a", type: "color" }).ok).toBe(false);
    expect(
      validateFieldInput({ label: "a", type: "select", options: [] }).ok,
    ).toBe(false);
    expect(
      validateFieldInput({
        label: "a",
        type: "select",
        options: Array.from({ length: 51 }, (_, i) => `o${i}`),
      }).ok,
    ).toBe(false);
  });
});

describe("normalizeValue", () => {
  it("makes empty input none", () => {
    expect(normalizeValue(def({ type: "text" }), "  ")).toEqual({
      ok: true,
      value: null,
    });
    expect(normalizeValue(def({ type: "number" }), null)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("checks each type", () => {
    expect(normalizeValue(def({ type: "text" }), " Portra ")).toEqual({
      ok: true,
      value: "Portra",
    });
    expect(normalizeValue(def({ type: "text" }), "a\nb").ok).toBe(false);
    expect(normalizeValue(def({ type: "text" }), "a".repeat(201)).ok).toBe(
      false,
    );
    expect(normalizeValue(def({ type: "number" }), "４００")).toEqual({
      ok: true,
      value: 400,
    });
    expect(normalizeValue(def({ type: "number" }), "1,600")).toEqual({
      ok: true,
      value: 1600,
    });
    expect(normalizeValue(def({ type: "number" }), "-0.5")).toEqual({
      ok: true,
      value: -0.5,
    });
    expect(normalizeValue(def({ type: "number" }), 3.5)).toEqual({
      ok: true,
      value: 3.5,
    });
    for (const bad of ["1e3", "abc", "0x10", "Infinity", "1e400"]) {
      expect(normalizeValue(def({ type: "number" }), bad).ok).toBe(false);
    }
    expect(normalizeValue(def({ type: "date" }), "2024-02-29")).toEqual({
      ok: true,
      value: "2024-02-29",
    });
    expect(normalizeValue(def({ type: "date" }), "2023-02-29").ok).toBe(false);
    expect(normalizeValue(def({ type: "date" }), "2024/02/01").ok).toBe(false);
    const select = def({ type: "select", options: ["Portra 400", "HP5"] });
    expect(normalizeValue(select, "HP5")).toEqual({ ok: true, value: "HP5" });
    expect(normalizeValue(select, "Tri-X").ok).toBe(false);
  });

  it("refuses values of the wrong shape", () => {
    expect(normalizeValue(def({ type: "text" }), 3).ok).toBe(false);
    expect(normalizeValue(def({ type: "text" }), ["a"]).ok).toBe(false);
  });
});

describe("readValue", () => {
  it("keeps only what the type can hold", () => {
    expect(readValue("number", 400)).toBe(400);
    expect(readValue("number", "400")).toBeNull();
    expect(readValue("text", "")).toBeNull();
    expect(readValue("text", "a\u0000")).toBeNull();
    expect(readValue("date", "2024-13-01")).toBeNull();
    // A select value whose option was removed since.
    expect(readValue("select", "Old stock")).toBe("Old stock");
  });
});

describe("levels", () => {
  it("fails closed on unknown levels and falls back to the field", () => {
    const levels = parseLevelMap('{"1":"shown","2":"maybe","3":null}');
    expect(levels).toEqual({ "1": "shown", "2": "hidden" });
    expect(levelOf({ id: 3, visibility: "shown" }, levels)).toBe("shown");
    expect(levelOf({ id: 2, visibility: "shown" }, levels)).toBe("hidden");
    expect(parseLevelMap("[1]")).toEqual({});
    expect(parseLevelMap("{")).toEqual({});
  });
});

describe("publicTagFields", () => {
  const defs = [
    def({ id: 2, label: "ISO", type: "number", position: 1 }),
    def({ id: 1, label: "銘柄", type: "text", position: 0 }),
    def({ id: 3, label: "ラボ", type: "text", position: 2, visibility: "hidden" }),
    def({ id: 4, tag: "旅行", label: "行き先", type: "text" }),
  ];
  const values = JSON.stringify({ 1: "Portra", 2: 400, 3: "Lab", 4: "京都" });

  it("lists the shown fields with a value, by tag then position", () => {
    expect(publicTagFields(["旅行", "フィルム"], defs, values, null)).toEqual([
      { tag: "旅行", label: "行き先", value: "京都" },
      { tag: "フィルム", label: "銘柄", value: "Portra" },
      { tag: "フィルム", label: "ISO", value: 400 },
    ]);
  });

  it("leaves out tags not shown, and fields hidden on the photo", () => {
    expect(publicTagFields([], defs, values, null)).toEqual([]);
    expect(
      publicTagFields(["フィルム"], defs, values, '{"1":"hidden","3":"shown"}'),
    ).toEqual([
      { tag: "フィルム", label: "ISO", value: 400 },
      { tag: "フィルム", label: "ラボ", value: "Lab" },
    ]);
    expect(publicTagFields(["フィルム"], defs, "not json", null)).toEqual([]);
  });
});

describe("formatValue", () => {
  it("writes numbers as plain decimals that read back", () => {
    for (const n of [400, 0.0000001, 1.8, -0.5, 123456789012345]) {
      const text = formatValue(n);
      expect(text).not.toMatch(/e/);
      expect(normalizeValue(def({ type: "number" }), text)).toEqual({
        ok: true,
        value: n,
      });
    }
    expect(formatValue("Portra")).toBe("Portra");
  });
});

describe("rowToDef", () => {
  it("reads a row, failing closed", () => {
    const row = {
      id: 1,
      tag: "t",
      label: "l",
      type: "select",
      options: '["a", 1]',
      visibility: "nope",
      position: 0,
    };
    expect(rowToDef(row)).toMatchObject({ options: ["a"], visibility: "hidden" });
    expect(rowToDef({ ...row, type: "color" })).toBeNull();
    expect(rowToDef({ ...row, type: "text", visibility: "shown" })).toMatchObject(
      { options: null, visibility: "shown" },
    );
  });
});
