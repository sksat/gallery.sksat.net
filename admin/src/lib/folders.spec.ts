import { describe, expect, it } from "vitest";
import {
  ancestors,
  buildFolderTree,
  dirOf,
  filesInDir,
  findFolder,
  isWithin,
  normalizeDir,
} from "./folders";

const FILES = [
  "/VRChat/2023-12/b.png",
  "/VRChat/2023-12/a.png",
  "/VRChat/2024-01/c.png",
  "/2023-12-comsys2023/x.jpg",
  "/top.png",
];

describe("normalizeDir", () => {
  it("defaults to the root", () => {
    expect(normalizeDir(null)).toBe("/");
    expect(normalizeDir(undefined)).toBe("/");
    expect(normalizeDir("")).toBe("/");
    expect(normalizeDir("/")).toBe("/");
  });

  it("adds the leading slash and drops trailing / repeated ones", () => {
    expect(normalizeDir("VRChat/2023-12/")).toBe("/VRChat/2023-12");
    expect(normalizeDir("//VRChat//2023-12")).toBe("/VRChat/2023-12");
  });

  it("rejects dot segments", () => {
    expect(normalizeDir("/VRChat/../x")).toBe("/");
    expect(normalizeDir("/./VRChat")).toBe("/");
  });
});

describe("dirOf", () => {
  it("returns the containing folder", () => {
    expect(dirOf("/VRChat/2023-12/a.png")).toBe("/VRChat/2023-12");
    expect(dirOf("/top.png")).toBe("/");
    expect(dirOf("top.png")).toBe("/");
  });
});

describe("buildFolderTree", () => {
  const tree = buildFolderTree(FILES);

  it("counts files recursively", () => {
    expect(tree.path).toBe("/");
    expect(tree.count).toBe(5);
    const vrchat = tree.children.find((c) => c.name === "VRChat");
    expect(vrchat?.count).toBe(3);
    expect(vrchat?.children.map((c) => [c.path, c.count])).toEqual([
      ["/VRChat/2023-12", 2],
      ["/VRChat/2024-01", 1],
    ]);
  });

  it("sorts subfolders by name", () => {
    expect(tree.children.map((c) => c.name)).toEqual([
      "2023-12-comsys2023",
      "VRChat",
    ]);
  });

  it("is an empty root for no files", () => {
    expect(buildFolderTree([])).toEqual({
      name: "",
      path: "/",
      count: 0,
      children: [],
    });
  });
});

describe("findFolder", () => {
  const tree = buildFolderTree(FILES);

  it("finds nested folders and the root", () => {
    expect(findFolder(tree, "/")).toBe(tree);
    expect(findFolder(tree, "/VRChat/2024-01")?.count).toBe(1);
  });

  it("returns null for a folder without files", () => {
    expect(findFolder(tree, "/VRChat/2099-01")).toBeNull();
    expect(findFolder(tree, "/nope")).toBeNull();
  });
});

describe("ancestors", () => {
  it("lists the root, then each folder down to dir", () => {
    expect(ancestors("/")).toEqual([{ name: "", path: "/" }]);
    expect(ancestors("/VRChat/2023-12")).toEqual([
      { name: "", path: "/" },
      { name: "VRChat", path: "/VRChat" },
      { name: "2023-12", path: "/VRChat/2023-12" },
    ]);
  });
});

describe("isWithin", () => {
  it("matches the folder itself and its descendants only", () => {
    expect(isWithin("/VRChat/2023-12", "/VRChat")).toBe(true);
    expect(isWithin("/VRChat", "/VRChat")).toBe(true);
    expect(isWithin("/anything", "/")).toBe(true);
    expect(isWithin("/VRChatX", "/VRChat")).toBe(false);
    expect(isWithin("/", "/VRChat")).toBe(false);
  });
});

describe("filesInDir", () => {
  const rows = FILES.map((file, id) => ({ id, file }));

  it("keeps direct children only, sorted by file name", () => {
    expect(filesInDir(rows, "/VRChat/2023-12").map((r) => r.file)).toEqual([
      "/VRChat/2023-12/a.png",
      "/VRChat/2023-12/b.png",
    ]);
    expect(filesInDir(rows, "/").map((r) => r.file)).toEqual(["/top.png"]);
    expect(filesInDir(rows, "/VRChat")).toEqual([]);
  });
});
