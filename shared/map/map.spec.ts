import { describe, expect, it } from "vitest";

import {
  boundsOf,
  circleRing,
  clusterByGrid,
  formatLatLng,
  groupPlaces,
  isLatLng,
  uncertaintyMeters,
  worldPixel,
} from "./map";

it("uncertaintyMeters: half a rounding cell's diagonal", () => {
  expect(uncertaintyMeters("exact")).toBe(0);
  // 0.005° (half of 0.01°) both ways ≈ 557 m, times √2.
  expect(Math.round(uncertaintyMeters("city"))).toBe(787);
  expect(Math.round(uncertaintyMeters("prefecture"))).toBe(7872);
  expect(Math.round(uncertaintyMeters("country"))).toBe(78715);
});

describe("circleRing", () => {
  it("is closed and about `radius` away", () => {
    const ring = circleRing(35, 139, 1000, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
    // North point: 1000 m ≈ 0.00898° of latitude.
    expect(ring[4][1] - 35).toBeCloseTo(1000 / 111_320, 6);
    // East point is wider in degrees at 35°N.
    expect(ring[0][0] - 139).toBeCloseTo(
      1000 / (111_320 * Math.cos((35 * Math.PI) / 180)),
      6,
    );
  });
});

describe("groupPlaces", () => {
  it("groups by rounded position and precision", () => {
    const places = groupPlaces([
      { lat: 35.68, lng: 139.77, precision: "city", item: "a" },
      { lat: 35.68, lng: 139.77, precision: "city", item: "b" },
      { lat: 35.68, lng: 139.77, precision: "exact", item: "c" },
      { lat: Number.NaN, lng: 0, precision: "exact", item: "bad" },
    ]);
    expect(places.map((p) => [p.key, p.items])).toEqual([
      ["city:35.68,139.77", ["a", "b"]],
      ["exact:35.68,139.77", ["c"]],
    ]);
  });
});

describe("worldPixel / clusterByGrid", () => {
  it("projects the origin to the middle of the world", () => {
    // MapLibre: the world is 512 px wide at zoom 0.
    expect(worldPixel(0, 0, 0)).toEqual({ x: 256, y: 256 });
    expect(worldPixel(90, 180, 1).x).toBe(1024);
  });

  it("merges points closer than a cell, apart when zoomed in", () => {
    const pts = [
      { lat: 35.6812, lng: 139.7671, id: 1 },
      { lat: 35.6896, lng: 139.7006, id: 2 },
      { lat: 34.7025, lng: 135.4959, id: 3 },
    ];
    const far = clusterByGrid(pts, 4);
    expect(far.map((c) => c.members.map((m) => m.id))).toEqual([[1, 2], [3]]);
    expect(far[0].lat).toBeCloseTo((35.6812 + 35.6896) / 2, 6);
    const near = clusterByGrid(pts, 14);
    expect(near).toHaveLength(3);
  });
});

it("boundsOf", () => {
  expect(boundsOf([])).toBeNull();
  expect(
    boundsOf([
      { lat: 35, lng: 139 },
      { lat: 34, lng: 141 },
    ]),
  ).toEqual([
    [139, 34],
    [141, 35],
  ]);
});

it("formatLatLng and isLatLng", () => {
  expect(formatLatLng(35.6812, 139.7671)).toBe("35.68°N 139.77°E");
  expect(formatLatLng(-33.8688, -151.2093, 1)).toBe("33.9°S 151.2°W");
  expect(isLatLng(35, 139)).toBe(true);
  expect(isLatLng(91, 0)).toBe(false);
  expect(isLatLng(0, -181)).toBe(false);
  expect(isLatLng("1", 2)).toBe(false);
  expect(isLatLng(Number.NaN, 2)).toBe(false);
});
