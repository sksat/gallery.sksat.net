import { describe, it, expect } from "vitest";
import {
  dateParam,
  galleryUrl,
  navigateImage,
  photoIdFromPath,
  visibleMedia,
} from "./logic";
import type { MediaInfo } from "./types";

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
  const id = "abcdefghjk";

  it("returns / with no photo and no filter", () => {
    expect(galleryUrl(null, none)).toBe("/");
  });

  it("returns /photo/{id} for a selected photo", () => {
    expect(galleryUrl(id, none)).toBe(`/photo/${id}`);
  });

  it("keeps the tag filter in the query", () => {
    const filter = { tags: ["VRChat", "film"], mode: "or" as const };
    expect(galleryUrl(null, filter)).toBe("/?tag=VRChat&tag=film&mode=or");
    expect(galleryUrl(id, filter)).toBe(
      `/photo/${id}?tag=VRChat&tag=film&mode=or`,
    );
  });

  it("encodes tags", () => {
    expect(galleryUrl(null, { tags: ["夜 景&"], mode: "and" })).toBe(
      "/?tag=%E5%A4%9C+%E6%99%AF%26",
    );
  });

  it("appends a non-default sort order after the filter", () => {
    expect(galleryUrl(null, none, { kind: "old", seed: 0 })).toBe("/?sort=old");
    expect(
      galleryUrl(
        id,
        { tags: ["VRChat"], mode: "and" },
        { kind: "random", seed: 7 },
      ),
    ).toBe(`/photo/${id}?tag=VRChat&sort=random&seed=7`);
    expect(galleryUrl(null, none, { kind: "new", seed: 0 })).toBe("/");
  });

  it("returns to the camera page, and remembers it on a photo", () => {
    const newest = { kind: "new" as const, seed: 0 };
    expect(galleryUrl(null, none, newest, "virtuallens2")).toBe(
      "/camera/virtuallens2/",
    );
    expect(galleryUrl(id, none, newest, "virtuallens2")).toBe(
      `/photo/${id}?camera=virtuallens2`,
    );
    const filter = { tags: ["VRChat"], mode: "and" as const };
    const oldest = { kind: "old" as const, seed: 0 };
    expect(galleryUrl(null, filter, oldest, "virtuallens2")).toBe(
      "/camera/virtuallens2/?tag=VRChat&sort=old",
    );
    expect(galleryUrl(id, filter, oldest, "virtuallens2")).toBe(
      `/photo/${id}?camera=virtuallens2&tag=VRChat&sort=old`,
    );
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
  it("keeps ?date= on the gallery and on a photo", () => {
    expect(galleryUrl(null, none, undefined, null, "2023-12-04")).toBe(
      "/?date=2023-12-04",
    );
    expect(
      galleryUrl(
        "abcdefghjk",
        { tags: ["night"], mode: "and" },
        undefined,
        null,
        "2023-12",
      ),
    ).toBe("/photo/abcdefghjk?date=2023-12&tag=night");
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

describe("photoIdFromPath", () => {
  it("reads the public id from /photo/{id} with or without trailing slash", () => {
    expect(photoIdFromPath("/photo/abcdefghjk")).toBe("abcdefghjk");
    expect(photoIdFromPath("/photo/abcdefghjk/")).toBe("abcdefghjk");
  });

  it("returns null elsewhere, for old numeric ids and malformed ids", () => {
    expect(photoIdFromPath("/")).toBeNull();
    expect(photoIdFromPath("/photo/")).toBeNull();
    expect(photoIdFromPath("/photo/3")).toBeNull();
    expect(photoIdFromPath("/photo/abcdefghjo")).toBeNull();
    expect(photoIdFromPath("/photo/abcdefghjk/extra")).toBeNull();
  });
});
