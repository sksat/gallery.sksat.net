import { describe, expect, it } from "vitest";
import {
  mapClassBounds,
  mapClassLabels,
  mapClassOf,
  rampSteps,
  viewsByCode,
} from "./world-map";
import { WORLD_COUNTRIES } from "./world-map.gen";

describe("map classes", () => {
  it("spreads up to 5 classes on a log scale with round bounds", () => {
    expect(mapClassBounds(1000)).toEqual([1, 5, 20, 50, 200]);
    expect(mapClassLabels([1, 5, 20, 50, 200], 1234)).toEqual([
      "1–4",
      "5–19",
      "20–49",
      "50–199",
      "200–1,234",
    ]);
  });
  it("has fewer classes for small counts, none for none", () => {
    expect(mapClassBounds(3)).toEqual([1, 2]);
    expect(mapClassLabels([1, 2], 3)).toEqual(["1", "2–3"]);
    expect(mapClassBounds(1)).toEqual([1]);
    expect(mapClassBounds(0)).toEqual([]);
  });
  it("puts a count in its class", () => {
    const b = [1, 5, 20, 50, 200];
    expect(mapClassOf(0, b)).toBeNull();
    expect(mapClassOf(1, b)).toBe(0);
    expect(mapClassOf(4, b)).toBe(0);
    expect(mapClassOf(5, b)).toBe(1);
    expect(mapClassOf(199, b)).toBe(3);
    expect(mapClassOf(5000, b)).toBe(4);
  });
  it("spreads the classes over the ramp", () => {
    expect(rampSteps(5)).toEqual([0, 1, 2, 3, 4]);
    expect(rampSteps(2)).toEqual([0, 4]);
    expect(rampSteps(1)).toEqual([2]);
    expect(rampSteps(0)).toEqual([]);
  });
});

describe("country codes", () => {
  it("keeps ISO alpha-2 codes, adding up repeats", () => {
    const m = viewsByCode([
      { country: "JP", pageViews: 10 },
      { country: "us", pageViews: 2 },
      { country: "US", pageViews: 1 },
      { country: "XX", pageViews: 5 },
      { country: "T1", pageViews: 5 },
      { country: "", pageViews: 5 },
    ]);
    expect([...m]).toEqual([
      ["JP", 10],
      ["US", 3],
    ]);
  });
  it("the map's paths are keyed by the same codes", () => {
    const codes = new Map(WORLD_COUNTRIES.map((c) => [c.code, c.name]));
    // world-atlas ids are ISO numeric ("392"); the generator maps them.
    expect(codes.get("JP")).toBe("Japan");
    expect(codes.get("US")).toBe("United States of America");
    expect(codes.get("TW")).toBe("Taiwan");
    expect(codes.get("KR")).toBe("South Korea");
    expect(codes.get("FR")).toBe("France");
    expect(codes.get("XK")).toBe("Kosovo");
    expect(codes.has("AQ")).toBe(false);
    const named = WORLD_COUNTRIES.filter((c) => c.code !== null);
    expect(new Set(named.map((c) => c.code)).size).toBe(named.length);
    for (const c of named) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });
});
