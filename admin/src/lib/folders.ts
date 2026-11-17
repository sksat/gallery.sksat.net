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

/**
 * Folder tree of `files`, with recursive counts and sorted children.
 * `folders` (normalised paths of folders created in the admin, the
 * `folder` table) are added even when no file lives in them; they count
 * nothing themselves.
 */
export const buildFolderTree = (
  files: readonly string[],
  folders: readonly string[] = [],
): FolderNode => {
  const root: FolderNode = { name: "", path: "/", count: 0, children: [] };
  const index = new Map<string, FolderNode>([["/", root]]);
  /** Walk to `dir`, creating nodes; add `n` to every folder on the way. */
  const visit = (dir: string, n: number) => {
    root.count += n;
    let node = root;
    for (const segment of dir === "/" ? [] : dir.slice(1).split("/")) {
      const path =
        node.path === "/" ? `/${segment}` : `${node.path}/${segment}`;
      let child = index.get(path);
      if (!child) {
        child = { name: segment, path, count: 0, children: [] };
        index.set(path, child);
        node.children.push(child);
      }
      child.count += n;
      node = child;
    }
  };
  for (const file of files) visit(dirOf(file), 1);
  for (const folder of folders) visit(normalizeDir(folder), 0);
  for (const node of index.values()) node.children.sort(byName);
  return root;
};

/** Longest folder name (one path segment). */
export const MAX_FOLDER_NAME_LEN = 64;
/** Deepest folder ("/a/b" is 2). */
export const MAX_FOLDER_DEPTH = 8;
/** Longest folder path, leaving room for file names (media.file ≤ 500). */
export const MAX_FOLDER_PATH_LEN = 200;

/** Top-level folder of camera pictures (`/camera/<slug>/…`). */
export const RESERVED_TOP_FOLDER = "camera";

// The same characters as a bucket path segment (validateImageFile and the
// image Worker's parseImagePath): the path goes into URLs as is.
const FOLDER_NAME_RE = /^[A-Za-z0-9._-]+$/;

export type FolderResult =
  { ok: true; path: string } | { ok: false; error: string };

/**
 * A new folder's name, as typed: surrounding spaces are trimmed; then 1 to
 * MAX_FOLDER_NAME_LEN of ASCII letters, digits, ".", "_" and "-", not
 * starting with "." (no "." / "..", no hidden names). Non-ASCII names and
 * spaces are refused because the path ends up in bucket and image URLs
 * unescaped.
 */
export const validateFolderName = (
  raw: unknown,
): { ok: true; name: string } | { ok: false; error: string } => {
  if (typeof raw !== "string") return { ok: false, error: "name is required" };
  const name = raw.trim();
  if (name === "") return { ok: false, error: "フォルダ名を入力してください" };
  if (name.length > MAX_FOLDER_NAME_LEN) {
    return {
      ok: false,
      error: `フォルダ名は ${MAX_FOLDER_NAME_LEN} 文字までです`,
    };
  }
  if (!FOLDER_NAME_RE.test(name)) {
    return {
      ok: false,
      error: "使える文字は英数字と . _ - だけです",
    };
  }
  if (name.startsWith(".")) {
    return { ok: false, error: "「.」で始まる名前は使えません" };
  }
  return { ok: true, name };
};

/** `name` inside folder `dir` ("/" + "a" → "/a"; "/a" + "b" → "/a/b"). */
export const joinFolder = (dir: string, name: string): string =>
  dir === "/" ? `/${name}` : `${dir}/${name}`;

/**
 * A folder path that may be stored in `folder` / used as an upload
 * target: normalised ("/a/b", not the root), every segment a valid folder
 * name, at most MAX_FOLDER_DEPTH deep and MAX_FOLDER_PATH_LEN long.
 */
export const validateFolderPath = (raw: unknown): FolderResult => {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw === "/") {
    return { ok: false, error: "invalid folder path" };
  }
  const segments = raw.slice(1).split("/");
  for (const s of segments) {
    const v = validateFolderName(s);
    if (!v.ok || v.name !== s) {
      return { ok: false, error: `invalid folder name: ${s || "(empty)"}` };
    }
  }
  // Camera pictures (cameraImageDir in validate.ts); not photos.
  if (segments[0] === RESERVED_TOP_FOLDER) {
    return {
      ok: false,
      error: `/${RESERVED_TOP_FOLDER} はカメラの写真用に予約されています`,
    };
  }
  if (segments.length > MAX_FOLDER_DEPTH) {
    return {
      ok: false,
      error: `フォルダは ${MAX_FOLDER_DEPTH} 階層までです`,
    };
  }
  if (raw.length > MAX_FOLDER_PATH_LEN) {
    return {
      ok: false,
      error: `フォルダのパスは ${MAX_FOLDER_PATH_LEN} 文字までです`,
    };
  }
  return { ok: true, path: raw };
};

/** Validate a new folder `name` typed inside `dir`. */
export const newFolderPath = (dir: string, name: unknown): FolderResult => {
  const v = validateFolderName(name);
  if (!v.ok) return v;
  return validateFolderPath(joinFolder(normalizeDir(dir), v.name));
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
