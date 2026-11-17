// Folder view of the media rows (the "Files" view on /media): a tree built
// from the `file` paths, e.g. "/VRChat/2023-12/a.png" lives in
// "/VRChat/2023-12". Pure functions only so they stay covered by Vitest
// (see folders.spec.ts).

/** One folder. `path` has a leading slash and no trailing one ("/" = root). */
export type FolderNode = {
  name: string;
  path: string;
  /** Files in this folder and all of its subfolders. */
  count: number;
  /** Subfolders, sorted by name. */
  children: FolderNode[];
};

/**
 * Normalise a `dir` query value to a folder path: leading slash, no
 * trailing slash, no empty / "." / ".." segments. Anything unusable is the
 * root ("/").
 */
export const normalizeDir = (raw: string | null | undefined): string => {
  if (!raw) return "/";
  const segments = raw.split("/").filter((s) => s !== "");
  if (segments.some((s) => s === "." || s === "..")) return "/";
  return "/" + segments.join("/");
};

/** Folder that directly contains `file` ("/a/b.png" → "/a"; "/b.png" → "/"). */
export const dirOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return normalizeDir(i <= 0 ? "/" : file.slice(0, i));
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/** Folder tree of `files`, with recursive counts and sorted children. */
export const buildFolderTree = (files: readonly string[]): FolderNode => {
  const root: FolderNode = { name: "", path: "/", count: 0, children: [] };
  const index = new Map<string, FolderNode>([["/", root]]);
  for (const file of files) {
    const dir = dirOf(file);
    root.count++;
    let node = root;
    for (const segment of dir === "/" ? [] : dir.slice(1).split("/")) {
      const path = node.path === "/" ? `/${segment}` : `${node.path}/${segment}`;
      let child = index.get(path);
      if (!child) {
        child = { name: segment, path, count: 0, children: [] };
        index.set(path, child);
        node.children.push(child);
      }
      child.count++;
      node = child;
    }
  }
  for (const node of index.values()) node.children.sort(byName);
  return root;
};

/** The node at `dir`, or null if no file lives under it. */
export const findFolder = (
  root: FolderNode,
  dir: string,
): FolderNode | null => {
  if (dir === "/") return root;
  let node: FolderNode | undefined = root;
  for (const segment of dir.slice(1).split("/")) {
    node = node.children.find((c) => c.name === segment);
    if (!node) return null;
  }
  return node;
};

/**
 * `dir` and the folders above it, root first, as breadcrumb entries:
 * "/a/b" → [{ name: "", path: "/" }, { name: "a", path: "/a" }, { name: "b", path: "/a/b" }].
 */
export const ancestors = (dir: string): { name: string; path: string }[] => {
  const out = [{ name: "", path: "/" }];
  if (dir === "/") return out;
  let path = "";
  for (const segment of dir.slice(1).split("/")) {
    path += `/${segment}`;
    out.push({ name: segment, path });
  }
  return out;
};

/** True if `dir` is `folder` itself or inside it. */
export const isWithin = (dir: string, folder: string): boolean =>
  folder === "/" || dir === folder || dir.startsWith(`${folder}/`);

/** Rows whose file sits directly in `dir`, sorted by file name. */
export const filesInDir = <T extends { file: string }>(
  rows: readonly T[],
  dir: string,
): T[] =>
  rows
    .filter((r) => dirOf(r.file) === dir)
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
