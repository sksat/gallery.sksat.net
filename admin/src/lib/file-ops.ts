// Moving and renaming photos and folders in the admin's Files view, as pure
// planning (file-ops.spec.ts): given what is there now and what to move
// where, the new path of every photo and created folder that changes, or
// why it cannot be done. Only display paths move (media.path, folder.path);
// the B2 keys (media.file) never do. db-ops.ts applies a plan in one batch.
//
// A name that is already taken at the destination is refused (with the
// names), never merged or renumbered: the user picks another name. Moving
// a folder into itself or below itself is refused too.

import { dirOf, joinFolder, validateFolderPath } from "./folders";
import { MAX_IMAGE_FILE_LEN, validateImageFile } from "./validate";

/** Last segment of a path ("/a/b.png" → "b.png"). */
export const baseName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/** What is in the Files view now (photos not in the trash, folder rows). */
export type Tree = {
  photos: readonly { id: number; path: string }[];
  /** Rows of the `folder` table (empty folders and kept ones). */
  folders: readonly string[];
};

/** One thing to move: a photo by id, or a folder by path, to `to`. */
export type Move =
  | { kind: "photo"; id: number; to: string }
  | { kind: "folder"; from: string; to: string };

export type Plan = {
  /** Photos whose path changes (folder contents included). */
  photos: { id: number; from: string; to: string }[];
  /** Folder-table prefixes to rewrite (each folder moved). */
  folders: { from: string; to: string }[];
  /**
   * Folders that must keep existing once photos leave them (the photo's
   * old folder, unless it moved itself): file managers keep folders.
   */
  keep: string[];
};

export type PlanResult =
  { ok: true; plan: Plan } | { ok: false; error: string };

const under = (path: string, folder: string) =>
  folder === "/" ? true : path.startsWith(`${folder}/`);

/** Every folder that exists, implicitly (has photos below) or as a row. */
const allFolders = (tree: Tree): Set<string> => {
  const out = new Set<string>(tree.folders);
  const add = (dir: string) => {
    for (let d = dir; d !== "/" && !out.has(d); d = dirOf(d)) out.add(d);
  };
  for (const p of tree.photos) add(dirOf(p.path));
  for (const f of tree.folders) add(dirOf(f));
  return out;
};

/**
 * Plan `moves`. Photo moves name the photo's new path; folder moves the
 * folder's new path. Contents of a moved folder follow it.
 */
export const planMoves = (tree: Tree, moves: readonly Move[]): PlanResult => {
  const byId = new Map(tree.photos.map((p) => [p.id, p.path]));
  const folders = allFolders(tree);
  const folderMoves: { from: string; to: string }[] = [];
  const photoTargets = new Map<number, string>();

  for (const m of moves) {
    if (m.kind === "folder") {
      if (!folders.has(m.from)) {
        return { ok: false, error: `フォルダ ${m.from} がありません` };
      }
      if (m.to === m.from) continue;
      if (under(m.to, m.from)) {
        return {
          ok: false,
          error: `${m.from} をその中には移動できません`,
        };
      }
      const v = validateFolderPath(m.to);
      if (!v.ok) return v;
      folderMoves.push({ from: m.from, to: m.to });
    } else {
      const from = byId.get(m.id);
      if (from === undefined) {
        return { ok: false, error: `写真 #${m.id} がありません` };
      }
      if (m.to === from) continue;
      const v = validateImageFile(m.to);
      if (!v.ok) return { ok: false, error: v.error };
      const dir = dirOf(m.to);
      if (dir !== "/") {
        const d = validateFolderPath(dir);
        if (!d.ok) return d;
      }
      photoTargets.set(m.id, m.to);
    }
  }
  // A folder inside another moved folder moves with it already.
  const topFolders = folderMoves.filter(
    (f) => !folderMoves.some((g) => g !== f && under(f.from, g.from)),
  );

  const movedFolder = (path: string) =>
    topFolders.find((f) => path === f.from || under(path, f.from));
  const remap = (path: string): string => {
    const f = movedFolder(path);
    return f ? f.to + path.slice(f.from.length) : path;
  };

  // New path of every photo.
  const photos: Plan["photos"] = [];
  const finalPaths = new Map<string, number>();
  for (const p of tree.photos) {
    const to = photoTargets.get(p.id) ?? remap(p.path);
    if (to !== p.path) photos.push({ id: p.id, from: p.path, to });
    const clash = finalPaths.get(to);
    if (clash !== undefined) {
      return { ok: false, error: `${to} はすでにあります` };
    }
    finalPaths.set(to, p.id);
    if (to.length > MAX_IMAGE_FILE_LEN) {
      return { ok: false, error: `${to} は長すぎます` };
    }
  }

  // Folders after the move: a moved folder must not land on one that stays.
  const staying = [...folders].filter((f) => !movedFolder(f));
  for (const f of topFolders) {
    if (staying.includes(f.to) || finalPaths.has(f.to)) {
      return { ok: false, error: `${f.to} はすでにあります` };
    }
  }
  const newFolders = new Set([...folders].map(remap));
  for (const p of photos) {
    if (newFolders.has(p.to)) {
      return { ok: false, error: `${p.to} はすでにフォルダとしてあります` };
    }
  }
  for (const f of folders) {
    const to = remap(f);
    if (to !== f) {
      const v = validateFolderPath(to);
      if (!v.ok) return { ok: false, error: `${to}: ${v.error}` };
    }
  }
  // No photo may sit where another one is a folder on its way
  // ("/x.png/y.png" while "/x.png" is a photo), for photos and folders.
  for (const path of [...finalPaths.keys(), ...newFolders]) {
    for (let d = dirOf(path); d !== "/"; d = dirOf(d)) {
      if (finalPaths.has(d)) {
        return { ok: false, error: `${d} は写真なのでフォルダにできません` };
      }
    }
  }

  // Folders that something left stay, as in any file manager.
  const keep = [
    ...new Set(
      [
        ...photos.filter((p) => photoTargets.has(p.id)).map((p) => p.from),
        ...topFolders.map((f) => f.from),
      ]
        .map(dirOf)
        .filter((d) => d !== "/" && !movedFolder(d)),
    ),
  ].sort();
  return { ok: true, plan: { photos, folders: topFolders, keep } };
};

/** Moves that put photos (by id) and folders into folder `dest`. */
export const intoFolder = (
  tree: Tree,
  dest: string,
  items: { photos: readonly number[]; folders: readonly string[] },
): Move[] => {
  const byId = new Map(tree.photos.map((p) => [p.id, p.path]));
  return [
    ...items.folders.map((from): Move => ({
      kind: "folder",
      from,
      to: joinFolder(dest, baseName(from)),
    })),
    ...items.photos.flatMap((id): Move[] => {
      const from = byId.get(id);
      return from === undefined
        ? []
        : [{ kind: "photo", id, to: joinFolder(dest, baseName(from)) }];
    }),
  ];
};

/** The moves that undo `plan` (everything back where it was). */
export const undoMoves = (plan: Plan): Move[] => [
  ...plan.folders.map((f): Move => ({
    kind: "folder",
    from: f.to,
    to: f.from,
  })),
  // Photos inside moved folders come back with their folder.
  ...plan.photos
    .filter((p) => !plan.folders.some((f) => under(p.from, f.from)))
    .map((p): Move => ({ kind: "photo", id: p.id, to: p.from })),
];
