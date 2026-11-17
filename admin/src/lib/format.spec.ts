import { describe, expect, it } from "vitest";
import {
  formatJst,
  lastPage,
  mediaEditHref,
  mediaListHref,
  parseView,
  publicPhotoUrl,
  safeBackHref,
  splitPath,
} from "./format";

describe("mediaListHref visibility", () => {
  it("keeps the visibility filter", () => {
    expect(mediaListHref({ visibility: "private", page: 2 })).toBe(
      "/media/?visibility=private&page=2",
    );
  });
});

describe("publicPhotoUrl", () => {
  it("points at the photo page on the public site", () => {
    expect(publicPhotoUrl("abcdefghjk")).toBe(
      "https://gallery.sksat.net/photo/abcdefghjk/",
    );
  });
});

describe("mediaEditHref / safeBackHref", () => {
  it("keeps the list URL so the edit page can go back to it", () => {
    const back = "/media/?view=files&dir=/VRChat/2023-12";
    const href = mediaEditHref(3, back);
    expect(href).toBe(
      "/media/3/?back=%2Fmedia%2F%3Fview%3Dfiles%26dir%3D%2FVRChat%2F2023-12",
    );
    const raw = new URL(href, "https://admin.example").searchParams.get("back");
    expect(safeBackHref(raw)).toBe(back);
  });

  it("omits back for the list root", () => {
    expect(mediaEditHref(3, "/media/")).toBe("/media/3/");
  });

  it("falls back to the list root for anything but a /media list URL", () => {
    expect(safeBackHref(null)).toBe("/media/");
    expect(safeBackHref("https://evil.example/media/")).toBe("/media/");
    expect(safeBackHref("//evil.example/media/")).toBe("/media/");
    expect(safeBackHref("/camera/")).toBe("/media/");
    expect(safeBackHref("/media/3/")).toBe("/media/");
    expect(safeBackHref("/media/?page=2")).toBe("/media/?page=2");
  });
});

describe("splitPath", () => {
  it("splits a nested path into folder and basename", () => {
    expect(
      splitPath("/VRChat/2023-12/VRChat_2023-12-11_01-21-32.519_7680x4320.png"),
    ).toEqual({
      dir: "/VRChat/2023-12/",
      base: "VRChat_2023-12-11_01-21-32.519_7680x4320.png",
    });
  });

  it("keeps the leading slash with the folder for a top-level file", () => {
    expect(splitPath("/a.png")).toEqual({ dir: "/", base: "a.png" });
  });

  it("returns an empty folder when there is no slash", () => {
    expect(splitPath("a.png")).toEqual({ dir: "", base: "a.png" });
  });

  it("concatenates back to the original path", () => {
    const p = "/mock/real1.png";
    const { dir, base } = splitPath(p);
    expect(dir + base).toBe(p);
  });
});

describe("formatJst", () => {
  it("renders an offset-aware timestamp in JST", () => {
    expect(formatJst("2023-12-11T01:21:32.519+09:00")).toBe("2023/12/11 01:21");
  });

  it("converts UTC to JST, crossing the date boundary", () => {
    expect(formatJst("2023-12-01T20:30:00Z")).toBe("2023/12/02 05:30");
  });

  it("returns null for null / empty", () => {
    expect(formatJst(null)).toBeNull();
    expect(formatJst("")).toBeNull();
  });

  it("passes an unparseable string through unchanged", () => {
    expect(formatJst("sometime in 2023")).toBe("sometime in 2023");
  });

  it("passes an offset-less timestamp through instead of guessing a zone", () => {
    expect(formatJst("2023-12-11T01:21:32")).toBe("2023-12-11T01:21:32");
  });

  it("accepts a compact offset", () => {
    expect(formatJst("2023-12-11T01:21:32+0900")).toBe("2023/12/11 01:21");
  });
});

describe("mediaListHref", () => {
  it("is the bare list URL for defaults", () => {
    expect(mediaListHref({})).toBe("/media/");
    expect(mediaListHref({ world: null, q: "", page: 1 })).toBe("/media/");
  });

  it("keeps the filter and drops page=1", () => {
    expect(mediaListHref({ world: "VRChat", q: "a b", page: 1 })).toBe(
      "/media/?world=VRChat&q=a+b",
    );
  });

  it("adds page beyond the first", () => {
    expect(mediaListHref({ q: "x", page: 3 })).toBe("/media/?q=x&page=3");
  });

  it("omits the default list view and ignores dir there", () => {
    expect(mediaListHref({ view: "list", dir: "/VRChat" })).toBe("/media/");
  });

  it("keeps the files view, a readable dir and the filter, but no page", () => {
    expect(
      mediaListHref({
        view: "files",
        dir: "/VRChat/2023-12",
        world: "VRChat",
        page: 2,
      }),
    ).toBe("/media/?view=files&dir=/VRChat/2023-12&world=VRChat");
    expect(mediaListHref({ view: "files", dir: "/" })).toBe(
      "/media/?view=files",
    );
  });

  it("still escapes other characters in dir", () => {
    expect(mediaListHref({ view: "files", dir: "/a b&c" })).toBe(
      "/media/?view=files&dir=/a+b%26c",
    );
  });
});

describe("parseView", () => {
  it("is files only for exactly 'files'", () => {
    expect(parseView("files")).toBe("files");
    expect(parseView("list")).toBe("list");
    expect(parseView(null)).toBe("list");
    expect(parseView("FILES")).toBe("list");
  });
});

describe("lastPage", () => {
  it("is 1 for an empty result", () => {
    expect(lastPage(0, 100)).toBe(1);
  });

  it("rounds up partial pages", () => {
    expect(lastPage(100, 100)).toBe(1);
    expect(lastPage(101, 100)).toBe(2);
  });
});
