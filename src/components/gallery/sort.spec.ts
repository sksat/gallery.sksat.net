import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  parseSort,
  serializeSort,
  sortMedia,
  type SortOrder,
} from "./sort";

const item = (index: number, iso: string | null) => ({
  index,
  value: { timestamp: iso === null ? null : new Date(iso) },
});

// index order: 0 (12-02), 1 (no date), 2 (12-03), 3 (12-01)
const items = [
  item(0, "2023-12-02T00:00:00Z"),
  item(1, null),
  item(2, "2023-12-03T00:00:00Z"),
  item(3, "2023-12-01T00:00:00Z"),
];
const order = (sort: SortOrder) => sortMedia(items, sort).map((m) => m.index);

describe("sortMedia", () => {
  it("newest first, undated last", () => {
    expect(order({ kind: "new", seed: 0 })).toEqual([2, 0, 3, 1]);
  });

  it("oldest first, undated last", () => {
    expect(order({ kind: "old", seed: 0 })).toEqual([3, 0, 2, 1]);
  });

  it("keeps the media.json order between equal or missing dates", () => {
    const same = [item(5, null), item(4, null), item(6, "2023-12-01T00:00:00Z")];
    expect(sortMedia(same, DEFAULT_SORT).map((m) => m.index)).toEqual([
      6, 4, 5,
    ]);
  });

  it("random is a permutation that depends only on the seed", () => {
    const a = order({ kind: "random", seed: 42 });
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
    expect(order({ kind: "random", seed: 42 })).toEqual(a);
    expect(
      sortMedia([...items].reverse(), { kind: "random", seed: 42 }).map(
        (m) => m.index,
      ),
    ).toEqual(a);
    const others = [1, 2, 3, 4, 5].map((seed) =>
      order({ kind: "random", seed }).join(),
    );
    expect(new Set([a.join(), ...others]).size).toBeGreaterThan(1);
  });

  it("does not mutate its input", () => {
    const copy = [...items];
    sortMedia(items, { kind: "old", seed: 0 });
    expect(items).toEqual(copy);
  });
});

describe("parseSort / serializeSort", () => {
  const roundTrip = (sort: SortOrder) =>
    parseSort(new URLSearchParams(serializeSort(sort)));

  it("defaults to newest first and writes nothing for it", () => {
    expect(parseSort(new URLSearchParams())).toEqual(DEFAULT_SORT);
    expect(serializeSort(DEFAULT_SORT)).toEqual([]);
  });

  it("round-trips old and random", () => {
    expect(roundTrip({ kind: "old", seed: 0 })).toEqual({
      kind: "old",
      seed: 0,
    });
    expect(roundTrip({ kind: "random", seed: 12345 })).toEqual({
      kind: "random",
      seed: 12345,
    });
  });

  it("ignores unknown values and a seed on non-random orders", () => {
    expect(parseSort(new URLSearchParams("sort=size"))).toEqual(DEFAULT_SORT);
    expect(parseSort(new URLSearchParams("sort=old&seed=9"))).toEqual({
      kind: "old",
      seed: 0,
    });
    expect(parseSort(new URLSearchParams("sort=random&seed=x"))).toEqual({
      kind: "random",
      seed: 0,
    });
  });
});
