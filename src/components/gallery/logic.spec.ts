import { describe, it, expect } from "vitest";
import {
  dateParam,
  galleryUrl,
  navigateImage,
  neighborIds,
  galleryStateFromUrl,
  photoIdFromPath,
  photoPageUrl,
  visibleMedia,
} from "./logic";
import type { MediaInfo } from "./types";

describe("neighborIds", () => {
  it("steps within the filter", () => {
    expect(neighborIds("b", ["a", "b", "c"], ["a", "x", "b", "c"])).toEqual({
      prev: "a",
      next: "c",
    });
    expect(neighborIds("a", ["a", "b"], ["a", "b"])).toEqual({
      prev: null,
      next: "b",
    });
  });

  it("falls back to every photo outside the filter, none when unlisted", () => {
    expect(neighborIds("x", ["a", "b"], ["a", "x", "b"])).toEqual({
      prev: "a",
      next: "b",
    });
    expect(neighborIds("u", ["a"], ["a"])).toEqual({ prev: null, next: null });
  });
});

describe("navigateImage", () => {
  const ids = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"];

  it("should navigate to next image", () => {
    expect(navigateImage("aaaaaaaaaa", ids, "next")).toBe("bbbbbbbbbb");
    expect(navigateImage("bbbbbbbbbb", ids, "next")).toBe("cccccccccc");
  });

  it("should return null at the end boundary (next)", () => {
    expect(navigateImage("cccccccccc", ids, "next")).toBeNull();
  });

  it("should navigate to previous image", () => {
    expect(navigateImage("cccccccccc", ids, "prev")).toBe("bbbbbbbbbb");
    expect(navigateImage("bbbbbbbbbb", ids, "prev")).toBe("aaaaaaaaaa");
  });

  it("should return null at the start boundary (prev)", () => {
    expect(navigateImage("aaaaaaaaaa", ids, "prev")).toBeNull();
  });

  it("should return null for a photo in no list (e.g. unlisted)", () => {
    expect(navigateImage("dddddddddd", ids, "next")).toBeNull();
    expect(navigateImage("dddddddddd", ids, "prev")).toBeNull();
  });

  it("should return null for empty or single-element lists", () => {
    expect(navigateImage("aaaaaaaaaa", [], "next")).toBeNull();
    expect(navigateImage("aaaaaaaaaa", ["aaaaaaaaaa"], "next")).toBeNull();
    expect(navigateImage("aaaaaaaaaa", ["aaaaaaaaaa"], "prev")).toBeNull();
  });
});

describe("galleryUrl", () => {
  const none = { tags: [], mode: "and" as const };

  it("returns / with no filter", () => {
    expect(galleryUrl(none)).toBe("/");
  });

  it("keeps the tag filter in the query", () => {
    const filter = { tags: ["VRChat", "film"], mode: "or" as const };
    expect(galleryUrl(filter)).toBe("/?tag=VRChat&tag=film&mode=or");
  });

  it("encodes tags", () => {
    expect(galleryUrl({ tags: ["夜 景&"], mode: "and" })).toBe(
      "/?tag=%E5%A4%9C+%E6%99%AF%26",
    );
  });

  it("appends a non-default sort order after the filter", () => {
    expect(galleryUrl(none, { kind: "old", seed: 0 })).toBe("/?sort=old");
    expect(
      galleryUrl({ tags: ["VRChat"], mode: "and" }, { kind: "random", seed: 7 }),
    ).toBe(`/?tag=VRChat&sort=random&seed=7`);
    expect(galleryUrl(none, { kind: "new", seed: 0 })).toBe("/");
  });

  it("is the camera page for a camera", () => {
    const newest = { kind: "new" as const, seed: 0 };
    expect(galleryUrl(none, newest, "virtuallens2")).toBe(
      "/camera/virtuallens2/",
    );
    const filter = { tags: ["VRChat"], mode: "and" as const };
    const oldest = { kind: "old" as const, seed: 0 };
    expect(galleryUrl(filter, oldest, "virtuallens2")).toBe(
      "/camera/virtuallens2/?tag=VRChat&sort=old",
    );
  });
});

describe("photoPageUrl", () => {
  const id = "abcdefghjk";

  it("is /photo/{id}/ alone by default", () => {
    expect(photoPageUrl(id)).toBe(`/photo/${id}/`);
  });

  it("carries the list it was opened from", () => {
    expect(
      photoPageUrl(
        id,
        { tags: ["VRChat", "night"], mode: "or" },
        { kind: "random", seed: 3 },
        "virtuallens2",
      ),
    ).toBe(
      `/photo/${id}/?camera=virtuallens2&tag=VRChat&tag=night&mode=or&sort=random&seed=3`,
    );
  });
});

describe("photoIdFromPath", () => {
  it("reads a public id from /photo/{id}/", () => {
    expect(photoIdFromPath("/photo/abcdefghjk/")).toBe("abcdefghjk");
    expect(photoIdFromPath("/photo/abcdefghjk")).toBe("abcdefghjk");
  });

  it("ignores anything else", () => {
    expect(photoIdFromPath("/")).toBeNull();
    expect(photoIdFromPath("/photo/3/")).toBeNull();
    expect(photoIdFromPath("/photo/abcdefghjo/")).toBeNull();
    expect(photoIdFromPath("/photo/abcdefghjk/x/")).toBeNull();
    expect(photoIdFromPath("/camera/abcdefghjk/")).toBeNull();
  });
});

describe("galleryStateFromUrl", () => {
  const at = (path: string) =>
    galleryStateFromUrl(new URL(path, "https://example.com"));
  const none = { tags: [], mode: "and" };
  const newest = { kind: "new", seed: 0 };

  it("reads a list URL", () => {
    expect(at("/?tag=night&sort=old&date=2023-12")).toEqual({
      selectedImageId: null,
      filter: { tags: ["night"], mode: "and" },
      sort: { kind: "old", seed: 0 },
      camera: null,
      date: "2023-12",
    });
    expect(at("/camera/virtuallens2/?date=2023-12")).toEqual({
      selectedImageId: null,
      filter: none,
      sort: newest,
      camera: "virtuallens2",
      date: null,
    });
  });

  it("ignores the old ?photo= on a list", () => {
    expect(at("/?photo=abcdefghjk").selectedImageId).toBeNull();
  });

  it("reads the overlay's photo URL back to the photo and its list", () => {
    const filter = { tags: ["VRChat"], mode: "or" as const };
    const random = { kind: "random" as const, seed: 3 };
    expect(
      at(photoPageUrl("abcdefghjk", filter, random, null, "2023-12-04")),
    ).toEqual({
      selectedImageId: "abcdefghjk",
      filter,
      sort: random,
      camera: null,
      date: "2023-12-04",
    });
    expect(
      at(photoPageUrl("abcdefghjk", filter, random, "virtuallens2")),
    ).toEqual({
      selectedImageId: "abcdefghjk",
      filter,
      sort: random,
      camera: "virtuallens2",
      date: null,
    });
  });

  it("goes back to the list the photo was opened over", () => {
    const filter = { tags: ["night"], mode: "and" as const };
    const sort = { kind: "old" as const, seed: 0 };
    const state = at(photoPageUrl("abcdefghjk", filter, sort, "virtuallens2"));
    expect(
      galleryUrl(state.filter, state.sort, state.camera, state.date),
    ).toBe(galleryUrl(filter, sort, "virtuallens2"));
  });
});

describe("visibleMedia", () => {
  const vl2 = {
    slug: "virtuallens2",
    name: "VirtualLens2",
    manufacturer: "logilabo",
    model: "VirtualLens2",
  };
  const photo = (
    id: string,
    platform: MediaInfo["platform"],
    camera: MediaInfo["camera"],
    tags: string[],
  ): MediaInfo => ({
    id,
    file: `/${id}`,
    platform,
    timestamp: null,
    camera,
    tags,
  });
  const media: MediaInfo[] = [
    photo("aaaaaaaaaa", "Real", null, []),
    photo("bbbbbbbbbb", "VRChat", vl2, ["night"]),
    photo("cccccccccc", "VRChat", vl2, []),
  ];
  const none = { tags: [], mode: "and" as const };

  it("shows everything without a camera", () => {
    expect(visibleMedia(media, none, null).map((m) => m.index)).toEqual([
      0, 1, 2,
    ]);
  });

  it("keeps the camera's photos with their global indices", () => {
    expect(
      visibleMedia(media, none, "virtuallens2").map((m) => m.index),
    ).toEqual([1, 2]);
  });

  it("applies the tag filter on top", () => {
    expect(
      visibleMedia(media, { tags: ["night"], mode: "and" }, "virtuallens2").map(
        (m) => m.index,
      ),
    ).toEqual([1]);
  });

  it("keeps a calendar date's photos (a month-only photo is on no day)", () => {
    const dated = [
      { ...media[0], takenDate: "2023-12-04" },
      { ...media[1], takenDate: "2023-12" },
      { ...media[2], takenDate: "2023" },
    ];
    const at = (date: string) =>
      visibleMedia(dated, none, null, date).map((m) => m.index);
    expect(at("2023-12-04")).toEqual([0]);
    expect(at("2023-12")).toEqual([0, 1]);
    expect(at("2023")).toEqual([0, 1, 2]);
    expect(at("2024")).toEqual([]);
    expect(
      visibleMedia(dated, none, "virtuallens2", "2023-12").map((m) => m.index),
    ).toEqual([1]);
  });
});

describe("galleryUrl with a date", () => {
  const none = { tags: [], mode: "and" as const };
  it("keeps ?date= on the gallery", () => {
    expect(galleryUrl(none, undefined, null, "2023-12-04")).toBe(
      "/?date=2023-12-04",
    );
    expect(
      galleryUrl({ tags: ["night"], mode: "and" }, undefined, null, "2023-12"),
    ).toBe("/?date=2023-12&tag=night");
  });

  it("keeps it on the photo's page", () => {
    expect(
      photoPageUrl("abcdefghjk", none, undefined, null, "2023-12-04"),
    ).toBe("/photo/abcdefghjk/?date=2023-12-04");
  });
});

describe("dateParam", () => {
  it("reads a real year, month or day", () => {
    const p = (q: string) => dateParam(new URLSearchParams(q));
    expect(p("date=2023-12-04")).toBe("2023-12-04");
    expect(p("date=2023")).toBe("2023");
    expect(p("date=2023-13")).toBeNull();
    expect(p("date=2023-02-30")).toBeNull();
    expect(p("date=")).toBeNull();
    expect(p("")).toBeNull();
  });
});

