// Files dropped on the Files view, folders included: walks the File and
// Directory Entries API (DataTransferItem.webkitGetAsEntry) into a flat
// list of files with their path relative to what was dropped, like
// webkitRelativePath of a folder upload ("Trip/day1/a.jpg"). The entry
// types are minimal structural ones so tests can pass fakes
// (drop-entries.spec.ts).

export type FileEntryLike = {
  isFile: true;
  isDirectory: false;
  name: string;
  file(ok: (f: File) => void, err?: (e: unknown) => void): void;
};

export type DirectoryEntryLike = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader(): {
    readEntries(
      ok: (entries: EntryLike[]) => void,
      err?: (e: unknown) => void,
    ): void;
  };
};

export type EntryLike = FileEntryLike | DirectoryEntryLike;

export type DroppedFile = { file: File; relativePath: string };

/** Most files taken from one drop (a stray drop of a huge tree). */
export const MAX_DROPPED_FILES = 5000;

/** Hidden files (".DS_Store", "._a.jpg") and folders are left out. */
const hidden = (name: string) => name.startsWith(".");

const readAll = async (dir: DirectoryEntryLike): Promise<EntryLike[]> => {
  const reader = dir.createReader();
  const out: EntryLike[] = [];
  // readEntries returns the children in batches until an empty one.
  for (;;) {
    const batch = await new Promise<EntryLike[]>((ok, err) =>
      reader.readEntries(ok, err),
    );
    if (batch.length === 0) return out;
    out.push(...batch);
  }
};

export type Collected = {
  files: DroppedFile[];
  /** Paths that could not be read (skipped; the rest is still there). */
  failed: string[];
  /** Stopped at the limit. */
  truncated: boolean;
};

/**
 * Every file under `entries`, depth first, in name order per folder.
 * Hidden files and folders inside are left out (what was dropped itself
 * is taken whatever its name). A file or folder that cannot be read is
 * listed in `failed` and skipped.
 */
export const collectDropped = async (
  entries: readonly EntryLike[],
  limit = MAX_DROPPED_FILES,
): Promise<Collected> => {
  const files: DroppedFile[] = [];
  const failed: string[] = [];
  let truncated = false;
  const walk = async (entry: EntryLike, prefix: string): Promise<void> => {
    if (prefix && hidden(entry.name)) return;
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    try {
      if (entry.isFile) {
        const file = await new Promise<File>((ok, err) => entry.file(ok, err));
        files.push({ file, relativePath: path });
        return;
      }
      const children = (await readAll(entry)).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const child of children) await walk(child, path);
    } catch {
      failed.push(path);
    }
  };
  for (const e of entries) await walk(e, "");
  return { files, failed, truncated };
};

/**
 * Put on every drag that starts in the page (at dragstart), so a drag
 * over the Files view can tell a move from files coming from outside. It
 * rides on the drag itself, so unlike a flag waiting for a dragend that
 * may never reach the document, it cannot outlive the drag.
 */
export const INTERNAL_DRAG_TYPE = "application/x-gallery-internal";

/**
 * Whether a drag over the Files view is taken as an upload, from its
 * `dataTransfer.types` (all that dragenter / dragover can read): any drag
 * that did not start in the page. The types are not trusted to say
 * "Files": Firefox, depending on the platform and the app the files come
 * from, may list only "application/x-moz-file", a URI list or text until
 * the drop. The drop then reads what files there are, and says so when
 * there are none.
 */
export const isUploadDrag = (types: readonly string[]): boolean =>
  !types.includes(INTERNAL_DRAG_TYPE);

/**
 * The dropEffect to accept an upload drag with: a copy, unless the drag
 * allows only something else. Firefox turns a dropEffect the source does
 * not allow into "none": the not-allowed cursor, and no drop event.
 */
export const uploadDropEffect = (
  effectAllowed: string | undefined,
): "copy" | "move" | "link" => {
  const a = (effectAllowed ?? "").toLowerCase();
  if (a === "" || a === "all" || a === "uninitialized" || a.includes("copy")) {
    return "copy";
  }
  if (a.includes("move")) return "move";
  if (a.includes("link")) return "link";
  return "copy";
};
