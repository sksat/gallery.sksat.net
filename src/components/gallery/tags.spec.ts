import { describe, it, expect } from "vitest";
import {
  mediaTags,
  tagCounts,
  filterMediaByTags,
  parseTagFilter,
  serializeTagFilter,
  toggleTag,
} from "./tags";
import type { MediaInfo } from "./types";

const media = (
  platform: MediaInfo["platform"],
  tags: string[],
): MediaInfo => ({
  id: "abcdefghjk",
  file: `/m/${platform}-${tags.join("-")}.jpg`,
  platform,
  timestamp: null,
  camera: null,
  tags,
});

// 0: Real film        1: VRChat (tag duplicates platform)
// 2: Real film night  3: VRChat night
// 4: Real (no tags)
const fixture: MediaInfo[] = [
  media("Real", ["film"]),
  media("VRChat", ["VRChat"]),
  media("Real", ["film", "night"]),
  media("VRChat", ["VRChat", "night"]),
  media("Real", []),
];

const indices = (entries: { index: number }[]) => entries.map((e) => e.index);

describe("mediaTags", () => {
  it("treats platform as a tag and does not duplicate it when also tagged", () => {
    expect(mediaTags(fixture[1])).toEqual(["VRChat"]);
    expect(mediaTags(fixture[2])).toEqual(["Real", "film", "night"]);
  });

  it("returns the platform even when tags are empty", () => {
    expect(mediaTags(fixture[4])).toEqual(["Real"]);
  });
});

describe("tagCounts", () => {
  it("counts each photo once per tag, most frequent first, ties in locale order", () => {
    expect(tagCounts(fixture)).toEqual([
      { tag: "Real", count: 3 },
      { tag: "film", count: 2 },
      { tag: "night", count: 2 },
      { tag: "VRChat", count: 2 },
    ]);
  });
});

describe("filterMediaByTags", () => {
  it("returns every photo with original indices when nothing is selected", () => {
    expect(
      indices(filterMediaByTags(fixture, { tags: [], mode: "and" })),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(
      indices(filterMediaByTags(fixture, { tags: [], mode: "or" })),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it("AND keeps only photos that have every selected tag", () => {
    expect(
      indices(
        filterMediaByTags(fixture, { tags: ["Real", "night"], mode: "and" }),
      ),
    ).toEqual([2]);
  });

  it("OR keeps photos that have any selected tag", () => {
    expect(
      indices(
        filterMediaByTags(fixture, { tags: ["film", "VRChat"], mode: "or" }),
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it("a platform tag selects by platform (single tag)", () => {
    expect(
      indices(filterMediaByTags(fixture, { tags: ["Real"], mode: "and" })),
    ).toEqual([0, 2, 4]);
  });

  it("an unknown tag yields nothing under AND but is ignored under OR", () => {
    expect(
      indices(
        filterMediaByTags(fixture, { tags: ["night", "nope"], mode: "and" }),
      ),
    ).toEqual([]);
    expect(
      indices(
        filterMediaByTags(fixture, { tags: ["night", "nope"], mode: "or" }),
      ),
    ).toEqual([2, 3]);
  });
});

describe("parseTagFilter", () => {
  it("defaults to no tags and AND", () => {
    expect(parseTagFilter(new URLSearchParams(""))).toEqual({
      tags: [],
      mode: "and",
    });
  });

  it("reads repeated tag params in order, dropping blanks and duplicates", () => {
    expect(
      parseTagFilter(
        new URLSearchParams("tag=night&tag=&tag=Real&tag=night&mode=or"),
      ),
    ).toEqual({ tags: ["night", "Real"], mode: "or" });
  });

  it("decodes percent-encoded and '+'-as-space tags from a raw query", () => {
    expect(
      parseTagFilter(
        new URLSearchParams("tag=%E5%A4%9C%E6%99%AF&tag=night+sky"),
      ).tags,
    ).toEqual(["夜景", "night sky"]);
  });

  it("falls back to AND for an unknown mode", () => {
    expect(parseTagFilter(new URLSearchParams("tag=a&mode=xor")).mode).toBe(
      "and",
    );
  });
});

describe("serializeTagFilter", () => {
  it("is empty for the default filter so the bare URL stays clean", () => {
    expect(serializeTagFilter({ tags: [], mode: "and" })).toBe("");
    // mode without tags has no effect, so it is not written either
    expect(serializeTagFilter({ tags: [], mode: "or" })).toBe("");
  });

  it("writes each tag once even if the selection has duplicates", () => {
    expect(serializeTagFilter({ tags: ["a", "a"], mode: "and" })).toBe("tag=a");
  });

  it("omits mode when it is the default", () => {
    expect(serializeTagFilter({ tags: ["Real", "film"], mode: "and" })).toBe(
      "tag=Real&tag=film",
    );
  });

  it("encodes non-ASCII tags and round-trips through parseTagFilter", () => {
    const filter = { tags: ["夜景", "a&b"], mode: "or" as const };
    const qs = serializeTagFilter(filter);
    expect(parseTagFilter(new URLSearchParams(qs))).toEqual(filter);
  });
});

describe("toggleTag", () => {
  it("appends an unselected tag and removes a selected one", () => {
    expect(toggleTag(["Real"], "film")).toEqual(["Real", "film"]);
    expect(toggleTag(["Real", "film"], "Real")).toEqual(["film"]);
  });
});
