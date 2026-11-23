import { describe, it, expect } from "vitest";
import {
  cameraCounts,
  dateParam,
  galleryUrl,
  navigateImage,
  neighborIds,
  galleryStateFromUrl,
  photoIdFromPath,
  photoDetailUrl,
  photoUrl,
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

  it("puts the camera filter first", () => {
    const newest = { kind: "new" as const, seed: 0 };
    expect(galleryUrl(none, newest, "virtuallens2")).toBe(
      "/?camera=virtuallens2",
    );
    const filter = { tags: ["VRChat"], mode: "and" as const };
    const oldest = { kind: "old" as const, seed: 0 };
    expect(galleryUrl(filter, oldest, "virtuallens2", "2023-12")).toBe(
      "/?camera=virtuallens2&date=2023-12&tag=VRChat&sort=old",
    );
  });
});

describe("photoUrl", () => {
  const id = "abcdefghjk";

  it("is /photo/{id}/ alone by default", () => {
    expect(photoUrl(id)).toBe(`/photo/${id}/`);
  });

  it("carries the list it was opened from", () => {
    expect(
      photoUrl(
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

describe("photoDetailUrl", () => {
  const id = "abcdefghjk";

  it("is /photo/{id}/detail/ alone by default", () => {
    expect(photoDetailUrl(id)).toBe(`/photo/${id}/detail/`);
  });

  it("carries the same list as the photo URL", () => {
    const filter = { tags: ["night"], mode: "and" as const };
    const sort = { kind: "old" as const, seed: 0 };
    expect(photoDetailUrl(id, filter, sort, null, "2023-12")).toBe(
      `/photo/${id}/detail/?date=2023-12&tag=night&sort=old`,
    );
    expect(photoDetailUrl(id, filter, sort, "virtuallens2")).toBe(
      photoUrl(id, filter, sort, "virtuallens2").replace(
        `/photo/${id}/`,
        `/photo/${id}/detail/`,
      ),
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
    // The detail page is not the overlay's URL.
    expect(photoIdFromPath("/photo/abcdefghjk/detail/")).toBeNull();
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
    expect(at("/?camera=virtuallens2&date=2023-12&tag=night")).toEqual({
      selectedImageId: null,
      filter: { tags: ["night"], mode: "and" },
      sort: newest,
      camera: "virtuallens2",
      date: "2023-12",
    });
  });

  it("reads a camera page as its camera's photos, newest first", () => {
    expect(at("/camera/virtuallens2/?date=2023-12&tag=a&sort=old")).toEqual({
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
      at(photoUrl("abcdefghjk", filter, random, null, "2023-12-04")),
    ).toEqual({
      selectedImageId: "abcdefghjk",
      filter,
      sort: random,
      camera: null,
      date: "2023-12-04",
    });
    expect(
      at(photoUrl("abcdefghjk", filter, random, "virtuallens2")),
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
    const state = at(photoUrl("abcdefghjk", filter, sort, "virtuallens2"));
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
      photoUrl("abcdefghjk", none, undefined, null, "2023-12-04"),
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

describe("cameraCounts", () => {
  const cam = (slug: string, name: string) => ({
    slug,
    name,
    manufacturer: null,
    model: null,
  });
  const photo = (
    id: string,
    camera: MediaInfo["camera"],
  ): MediaInfo => ({
    id,
    file: `/${id}`,
    platform: "Real",
    timestamp: null,
    camera,
    tags: [],
  });

  it("counts the photos of each camera, most first, then by name", () => {
    const b = cam("b", "B");
    const a = cam("a", "A");
    expect(
      cameraCounts(
        [
          photo("1", b),
          photo("2", null),
          photo("3", a),
          photo("4", b),
          photo("5", cam("c", "C")),
        ],
        null,
      ),
    ).toEqual([
      { slug: "b", name: "B", count: 2 },
      { slug: "a", name: "A", count: 1 },
      { slug: "c", name: "C", count: 1 },
    ]);
  });

  it("keeps the chosen camera when the other filters leave none", () => {
    expect(
      cameraCounts([photo("1", cam("a", "A"))], { slug: "z", name: "Z" }),
    ).toEqual([
      { slug: "a", name: "A", count: 1 },
      { slug: "z", name: "Z", count: 0 },
    ]);
  });
});

