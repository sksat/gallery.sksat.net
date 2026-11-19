import { describe, expect, it } from "vitest";
import {
  canDrop,
  DEFAULT_PREFS,
  moveFocus,
  parsePrefs,
  sortFolders,
  sortPhotos,
} from "./file-view";

const photo = (
  id: number,
  name: string,
  timestamp: string | null,
  size: number | null,
) => ({ id, path: `/d/${name}`, timestamp, size });

const photos = [
  photo(3, "img10.png", "2023-12-02T00:00:00Z", 300),
  photo(1, "img2.png", null, 100),
  photo(2, "img1.png", "2023-12-01T00:00:00Z", null),
];
const names = (ps: { path: string }[]) => ps.map((p) => p.path.slice(3));

describe("parsePrefs", () => {
  it("reads what was stored and defaults the rest", () => {
    expect(parsePrefs('{"sort":"size","dir":"desc","layout":"list"}')).toEqual({
      sort: "size",
      dir: "desc",
      layout: "list",
    });
    expect(parsePrefs('{"sort":"colour"}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("nope")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});

describe("sortPhotos", () => {
  it("sorts names naturally, either way", () => {
    expect(names(sortPhotos(photos, { sort: "name", dir: "asc" }))).toEqual([
      "img1.png",
      "img2.png",
      "img10.png",
    ]);
    expect(names(sortPhotos(photos, { sort: "name", dir: "desc" }))).toEqual([
      "img10.png",
      "img2.png",
      "img1.png",
    ]);
  });

  it("puts photos without a date or size last, both ways", () => {
    expect(names(sortPhotos(photos, { sort: "taken", dir: "asc" }))).toEqual([
      "img1.png",
      "img10.png",
      "img2.png",
    ]);
    expect(names(sortPhotos(photos, { sort: "taken", dir: "desc" }))).toEqual([
      "img10.png",
      "img1.png",
      "img2.png",
    ]);
    expect(names(sortPhotos(photos, { sort: "size", dir: "desc" }))).toEqual([
      "img10.png",
      "img2.png",
      "img1.png",
    ]);
  });

  it("compares dates as instants, whatever their offset", () => {
    const mixed = [
      photo(1, "late.png", "2026-11-17T23:30:00Z", 1),
      photo(2, "early.png", "2026-11-18T08:00:00+09:00", 1),
    ];
    expect(names(sortPhotos(mixed, { sort: "taken", dir: "asc" }))).toEqual([
      "early.png",
      "late.png",
    ]);
  });

  it("orders by when they were added (the row id)", () => {
    expect(names(sortPhotos(photos, { sort: "added", dir: "desc" }))).toEqual([
      "img10.png",
      "img1.png",
      "img2.png",
    ]);
  });
});

describe("sortFolders", () => {
  const folders = [
    { name: "b", bytes: 1 },
    { name: "a10", bytes: 5 },
    { name: "a9", bytes: 3 },
  ];
  it("by name or size; date orders keep names", () => {
    expect(
      sortFolders(folders, { sort: "name", dir: "desc" }).map((f) => f.name),
    ).toEqual(["b", "a10", "a9"]);
    expect(
      sortFolders(folders, { sort: "size", dir: "asc" }).map((f) => f.name),
    ).toEqual(["b", "a9", "a10"]);
    expect(
      sortFolders(folders, { sort: "taken", dir: "desc" }).map((f) => f.name),
    ).toEqual(["a9", "a10", "b"]);
  });
});

describe("moveFocus", () => {
  // 7 items, 3 wide:  0 1 2 / 3 4 5 / 6
  it("moves by one sideways and by a row up and down", () => {
    expect(moveFocus(4, "ArrowLeft", 7, 3)).toBe(3);
    expect(moveFocus(0, "ArrowLeft", 7, 3)).toBe(0);
    expect(moveFocus(6, "ArrowRight", 7, 3)).toBe(6);
    expect(moveFocus(4, "ArrowUp", 7, 3)).toBe(1);
    expect(moveFocus(1, "ArrowUp", 7, 3)).toBe(1);
    expect(moveFocus(1, "ArrowDown", 7, 3)).toBe(4);
  });

  it("down into a short last row lands on its last item", () => {
    expect(moveFocus(5, "ArrowDown", 7, 3)).toBe(6);
    expect(moveFocus(6, "ArrowDown", 7, 3)).toBe(6);
  });

  it("Home and End; other keys do not move", () => {
    expect(moveFocus(4, "Home", 7, 3)).toBe(0);
    expect(moveFocus(0, "End", 7, 3)).toBe(6);
    expect(moveFocus(0, "Enter", 7, 3)).toBeNull();
    expect(moveFocus(0, "ArrowDown", 0, 3)).toBeNull();
  });

  it("a list is one column", () => {
    expect(moveFocus(2, "ArrowDown", 7, 1)).toBe(3);
    expect(moveFocus(2, "ArrowUp", 7, 1)).toBe(1);
  });
});

describe("canDrop", () => {
  it("not where they are, nor a folder into itself or below it", () => {
    expect(canDrop("/a/b", "/a", [])).toBe(true);
    expect(canDrop("/a", "/a", [])).toBe(false);
    expect(canDrop("/a/b", "/a", ["/a/b"])).toBe(false);
    expect(canDrop("/a/b/c", "/a", ["/a/b"])).toBe(false);
    expect(canDrop("/", "/a", ["/a/b"])).toBe(true);
    expect(canDrop("/a/bc", "/a", ["/a/b"])).toBe(true);
  });
});
