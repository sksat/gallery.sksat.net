import {
  $,
  component$,
  useSignal,
  useTask$,
  useVisibleTask$,
} from "@builder.io/qwik";
import { isBrowser } from "@builder.io/qwik/build";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  useLocation,
  useNavigate,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { calendarHrefFor, dateParam } from "~/lib/calendar";
import { StatePanel } from "~/components/state-panel";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
  tagChip,
  VISIBILITY_LABELS,
  PLATFORM_LABEL,
  platformBadge,
} from "~/components/ui";
import {
  listMedia,
  MAX_BULK_IDS,
  restoreVisibility,
  setVisibility,
  type VisibilityChange,
} from "~/lib/db";
import { createFolder, listFolders, listMediaFiles } from "~/lib/db-files";
import {
  getSiteDefaults,
  restoreMetadataLevels,
  setMetadataLevels,
  type StoredLevels,
} from "~/lib/db-meta";
import { storedOverrides, validateLevelChange } from "~/lib/bulk-metadata";
import { inChunks } from "~/lib/selection";
import {
  listCameraChoices,
  restoreCameras,
  restorePlatforms,
  setCameras,
  setPlatforms,
  UnknownCameraError,
  type CameraChoice,
  type PreviousCamera,
  type PreviousPlatform,
} from "~/lib/db-photo-bulk";
import { parseOverrides, type MetadataLevels } from "~/lib/metadata";
import {
  loadTree,
  moveItems,
  RestoreError,
  restoreItems,
  trashItems,
} from "~/lib/db-ops";
import { intoFolder, undoMoves, type Move } from "~/lib/file-ops";
import {
  deleteIncompleteUpload,
  listIncompleteUploads,
  type IncompleteUpload,
} from "~/lib/db-upload";
import { getUploadConfig } from "~/lib/b2";
import { getObjectStat } from "~/lib/object-stat";
import {
  DropZone,
  IncompleteUploads,
  UploadButton,
  UploadFolderButton,
  UploadPanel,
  useUploader,
} from "~/components/uploader";
import {
  FileBrowser,
  type FileTile,
  type SelectedItems,
} from "~/components/file-browser";
import type { SelectionAction } from "~/components/selection-bar";
import { SubmitButton } from "~/components/submit-button";
import { Thumb } from "~/components/thumb";
import { VisibilityBadge } from "~/components/visibility-badge";
import {
  VISIBILITY_LABELS_JA,
  VISIBILITY_STYLE,
  VisibilityIcon,
} from "~/components/visibility-style";
import { Toast, type ToastState } from "~/components/toast";
import { getDB, getImageBase } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";
import {
  buildFolderTree,
  dirOf,
  filesInDir,
  findFolder,
  joinFolder,
  MAX_FOLDER_NAME_LEN,
  newFolderPath,
  normalizeDir,
  validateFolderPath,
  withAllStats,
  type FolderNode,
} from "~/lib/folders";
import {
  formatJst,
  lastPage,
  mediaEditHref,
  filterChips,
  mediaListHref,
  parseMediaAnchor,
  parseView,
  platformParam,
  splitPath,
  type MediaView,
} from "~/lib/format";
import {
  isVisibility,
  PLATFORMS,
  VISIBILITIES,
  type MediaRow,
  type MediaPlatform,
  type Visibility,
} from "~/lib/types";
import {
  validateBulkVisibility,
  validateRestoreVisibility,
} from "~/lib/validate";

// One page is also the most a bulk change can touch.
const PAGE_SIZE = MAX_BULK_IDS;
/**
 * The files view builds its tree from every (filtered) row in one query of
 * id/file/path/platform. Far above today's size; past it the tree is incomplete
 * (the alphabetically last paths are missing) and says so.
 */
const FILES_LIMIT = 10_000;

type FilesData = {
  tree: FolderNode;
  dir: string;
  folder: FolderNode | null;
  files: FileTile[];
  /** More rows matched than FILES_LIMIT. */
  truncated: boolean;
  /** The B2 upload key is configured (production only). */
  uploadEnabled: boolean;
  /** Uploads into `dir` that never completed. */
  incomplete: IncompleteUpload[];
  /** The site's metadata levels (what 既定 means in a bulk change). */
  siteDefaults: MetadataLevels;
  /** Cameras to pick in a bulk change. */
  cameras: CameraChoice[];
};

type MediaListResult =
  | {
      kind: "ok";
      view: MediaView;
      rows: MediaRow[];
      total: number;
      page: number;
      platform: MediaPlatform | null;
      visibility: Visibility | null;
      q: string;
      /** Taken in this year, month or day (`?date=`, from the calendar). */
      date: string | null;
      /** Image Worker base URL, or null for placeholder tiles. */
      imageBase: string | null;
      /** Only for view === "files". */
      files: FilesData | null;
    }
  | { kind: "missing-binding" };

export const useMediaList = routeLoader$<MediaListResult>(
  async ({ platform, query, status, redirect, url }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    // The platform filter (?platform=). Not
    // `platform`: that is the request's Cloudflare platform here.
    const onPlatform = platformParam(query) ?? undefined;
    const visibilityRaw = query.get("visibility");
    const visibility = isVisibility(visibilityRaw) ? visibilityRaw : undefined;
    const q = query.get("q")?.trim() || undefined;
    const date = dateParam(query) ?? undefined;
    const imageBase = getImageBase(platform);

    if (parseView(query.get("view")) === "files") {
      const { rows, truncated } = await listMediaFiles(db, {
        platform: onPlatform,
        visibility,
        q,
        date,
        limit: FILES_LIMIT,
      });
      const dir = normalizeDir(query.get("dir"));
      // Folders are where photos are shown (path), not where their files
      // are in the bucket.
      const filtered = Boolean(onPlatform || visibility || q || date);
      // Empty folders only when unfiltered: a filter shows where the
      // matching photos are.
      const folders = filtered ? [] : await listFolders(db);
      // Sizes and 公開 counts are each folder's own, filter or not.
      const tree = filtered
        ? withAllStats(
            buildFolderTree(rows, folders),
            buildFolderTree(
              (await listMediaFiles(db, { limit: FILES_LIMIT })).rows,
            ),
          )
        : buildFolderTree(rows, folders);
      return {
        kind: "ok",
        view: "files",
        rows: [],
        total: rows.length,
        page: 1,
        platform: onPlatform ?? null,
        visibility: visibility ?? null,
        q: q ?? "",
        date: date ?? null,
        imageBase,
        files: {
          tree,
          dir,
          folder: findFolder(tree, dir),
          files: filesInDir(rows, dir).map(
            ({ metadata_visibility, ...r }): FileTile => ({
              ...r,
              metadata: parseOverrides(metadata_visibility),
            }),
          ),
          truncated,
          // Both halves: the presigned PUT and the check that completes it.
          uploadEnabled:
            getUploadConfig(platform) !== null &&
            getObjectStat(platform, url, null) !== null,
          incomplete: (await listIncompleteUploads(db)).filter(
            (u) => dirOf(u.path) === dir,
          ),
          siteDefaults: await getSiteDefaults(db),
          cameras: await listCameraChoices(db),
        },
      };
    }

    const pageRaw = Number(query.get("page") ?? "1");
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const offset = (page - 1) * PAGE_SIZE;

    const { rows, total } = await listMedia(db, {
      platform: onPlatform,
      visibility,
      q,
      date,
      limit: PAGE_SIZE,
      offset,
    });
    // Past the end (stale link, or a filter that shrank the result): send
    // the user to the last page that has rows instead of "Page 2 / 1".
    if (rows.length === 0 && page > 1) {
      throw redirect(
        302,
        mediaListHref({
          platform: onPlatform,
          visibility,
          q,
          date,
          page: lastPage(total, PAGE_SIZE),
        }),
      );
    }
    return {
      kind: "ok",
      view: "list",
      rows,
      total,
      page,
      platform: onPlatform ?? null,
      visibility: visibility ?? null,
      q: q ?? "",
      date: date ?? null,
      imageBase,
      files: null,
    };
  },
);

/** Bulk change: set the visibility of the photos ticked on this page. */
export const useBulkVisibility = routeAction$(
  async (data, { platform, fail }) => {
    const v = validateBulkVisibility(
      { ids: data.ids, visibility: data.visibility },
      MAX_BULK_IDS,
    );
    if (!v.ok) return fail(400, { message: v.error });
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media bulk action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    const { changed, previous } = await setVisibility(db, v.ids, v.visibility);
    await contentChanged(db);
    return {
      ok: true,
      selected: v.ids.length,
      changed,
      visibility: v.visibility,
      /** What 「元に戻す」 restores. */
      previous,
    };
  },
  zod$({
    // `ids[]` in the form; Qwik City collects repeated `[]` keys.
    ids: z
      .array(z.string().max(20))
      .max(2 * MAX_BULK_IDS)
      .default([]),
    visibility: z.string().max(20),
  }),
);

/**
 * Files view selection → a visibility, one chunk (the page sends a larger
 * selection as several). Apart from useBulkVisibility, whose result the
 * list view turns into its toast and undo as it arrives.
 */
export const useSelectionVisibility = routeAction$(
  async (data, { platform }) => {
    const db = getDB(platform);
    const { changed, previous } = await setVisibility(
      db,
      data.ids,
      data.visibility,
    );
    await contentChanged(db);
    return { ok: true as const, changed, previous };
  },
  zod$({
    ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
    visibility: z.enum(VISIBILITIES),
  }),
);

/** Undo of a bulk change: each photo back to its previous visibility. */
export const useRestoreVisibility = routeAction$(
  async (data, { platform, fail }) => {
    const v = validateRestoreVisibility(data.changes, MAX_BULK_IDS);
    if (!v.ok) return fail(400, { message: v.error });
    // The visibility the bulk change set: only rows still at it go back.
    if (!isVisibility(data.from)) {
      return fail(400, { message: "invalid from" });
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media restore action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    const changed = await restoreVisibility(db, data.from, v.groups);
    await contentChanged(db);
    return { ok: true, changed };
  },
  zod$({
    from: z.string().max(20),
    changes: z
      .array(z.object({ id: z.number(), visibility: z.string().max(20) }))
      .max(2 * MAX_BULK_IDS),
  }),
);

/**
 * Reload the page data (after uploads). Any action re-runs the loaders;
 * this one does nothing else.
 */
export const useRefresh = routeAction$(() => ({ ok: true }));

/** Forget an upload that never completed (ready photos are refused). */
export const useDeleteIncomplete = routeAction$(
  async (data, { platform, fail }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media delete-incomplete action: getDB failed:", err);
      return fail(500, { message: "データベースに接続できません" });
    }
    if (!(await deleteIncompleteUpload(db, data.id))) {
      return fail(404, { message: "未完了のアップロードが見つかりません" });
    }
    // A camera picture with its file can be served by path again.
    await contentChanged(db);
    return { ok: true };
  },
  zod$({ id: z.number().int().positive() }),
);

/**
 * Files view: create a folder `name` inside `dir` and open it. A folder
 * exists without files only as a `folder` row (see 0004_upload.sql).
 */
export const useCreateFolder = routeAction$(
  async (data, { platform, fail, redirect }) => {
    const v = newFolderPath(data.dir, data.name);
    if (!v.ok) return fail(400, { message: v.error });
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media folder action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    if (!(await createFolder(db, v.path))) {
      return fail(409, { message: `${v.path} はすでにあります` });
    }
    throw redirect(302, mediaListHref({ view: "files", dir: v.path }));
  },
  zod$({
    dir: z.string().max(1000),
    name: z.string().max(1000),
  }),
);

/**
 * Files view: rename the open folder (`name` in the same parent), or put
 * it in the trash with everything in it. Both can be undone from the
 * toast (the moves back / a restore).
 */
export const useFolderOp = routeAction$(
  async (data, { platform, fail }) => {
    const dir = normalizeDir(data.dir);
    if (dir === "/") return fail(400, { message: "ルートは変更できません" });
    const db = getDB(platform);
    if (data.op === "rename") {
      const v = newFolderPath(dirOf(dir), data.name ?? "");
      if (!v.ok) return fail(400, { message: v.error });
      const r = await moveItems(db, [
        { kind: "folder", from: dir, to: v.path },
      ]);
      if (!r.ok) return fail(409, { message: r.error });
      await contentChanged(db);
      return {
        ok: true as const,
        op: "rename" as const,
        from: dir,
        to: v.path,
        undo: undoMoves(r.plan),
        trashed: null,
      };
    }
    const t = await trashItems(db, { photos: [], folders: [dir] });
    await contentChanged(db);
    return {
      ok: true as const,
      op: "trash" as const,
      from: dir,
      to: dirOf(dir),
      undo: null,
      trashed: t,
    };
  },
  zod$({
    op: z.enum(["rename", "trash"]),
    dir: z.string().max(600),
    name: z.string().max(200).optional(),
  }),
);

const selectionItems = {
  photos: z.array(z.number().int().positive()).max(10_000),
  // Folder paths as shown ("" or "/" would match every photo); not the
  // naming rules, which older folders may predate.
  folders: z
    .array(
      z
        .string()
        .max(600)
        .refine((f) => f !== "/" && normalizeDir(f) === f, "invalid folder"),
    )
    .max(10_000),
};

/**
 * Files view selection → 移動: the picked photos and folders into folder
 * `dest`, or into a new folder `name` made inside it. Undone like a
 * folder rename (useUndoFolderOp).
 */
export const useMoveSelection = routeAction$(
  async (data, { platform, fail }) => {
    let dest = normalizeDir(data.dest);
    if (data.name?.trim()) {
      const v = newFolderPath(dest, data.name);
      if (!v.ok) return fail(400, { message: v.error });
      dest = v.path;
    } else if (dest !== "/") {
      const v = validateFolderPath(dest);
      if (!v.ok) return fail(400, { message: v.error });
    }
    const db = getDB(platform);
    const items = { photos: data.photos, folders: data.folders };
    const r = await moveItems(db, intoFolder(await loadTree(db), dest, items));
    if (!r.ok) return fail(409, { message: r.error });
    await contentChanged(db);
    if (data.name?.trim()) await createFolder(db, dest);
    const undo = undoMoves(r.plan);
    // What moved: each moved folder, and each photo not inside one.
    return { ok: true as const, to: dest, count: undo.length, undo };
  },
  zod$({
    dest: z.string().max(600),
    name: z.string().max(200).optional(),
    ...selectionItems,
  }),
);

/**
 * Files view → 名前を変更 (F2, the context menu or the bar) on one photo
 * or folder: a new name in the same folder. Undone like a move.
 */
export const useRenameItem = routeAction$(
  async (data, { platform, fail }) => {
    const name = data.name.trim();
    if (!name) return fail(400, { message: "名前を入れてください" });
    if (name.includes("/")) {
      return fail(400, { message: "名前に / は使えません" });
    }
    const db = getDB(platform);
    let moves: Move[];
    if (data.folder !== undefined) {
      const v = newFolderPath(dirOf(data.folder), name);
      if (!v.ok) return fail(400, { message: v.error });
      moves = [{ kind: "folder", from: data.folder, to: v.path }];
    } else if (data.photo !== undefined) {
      const tree = await loadTree(db);
      const from = tree.photos.find((p) => p.id === data.photo)?.path;
      if (from === undefined) return fail(404, { message: "見つかりません" });
      moves = [
        { kind: "photo", id: data.photo, to: joinFolder(dirOf(from), name) },
      ];
    } else {
      return fail(400, { message: "nothing to rename" });
    }
    const r = await moveItems(db, moves);
    if (!r.ok) return fail(409, { message: r.error });
    await contentChanged(db);
    return { ok: true as const, name, undo: undoMoves(r.plan) };
  },
  zod$({
    photo: z.number().int().positive().optional(),
    folder: selectionItems.folders.element.optional(),
    name: z.string().max(200),
  }),
);

/** Files view selection → ゴミ箱へ (folders with everything in them). */
export const useTrashSelection = routeAction$(async (data, { platform }) => {
  const db = getDB(platform);
  const t = await trashItems(db, {
    photos: data.photos,
    folders: data.folders,
  });
  await contentChanged(db);
  return { ok: true as const, trashed: t };
}, zod$(selectionItems));

/**
 * Files view selection → 公開する情報: the given metadata levels on the
 * selected photos ("" = the site's default). Returns what changed photos
 * had, for 元に戻す (useRestoreMetadata).
 */
export const useBulkMetadata = routeAction$(
  async (data, { platform, fail }) => {
    const v = validateLevelChange(data.levels);
    if (!v.ok) return fail(400, { message: v.error });
    const db = getDB(platform);
    const previous = await setMetadataLevels(db, data.ids, v.value);
    await contentChanged(db);
    return { ok: true as const, selected: data.ids.length, previous };
  },
  zod$({
    ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
    levels: z.record(z.string(), z.string().max(20)),
  }),
);

/**
 * Files view selection → カメラ: one camera (or none) on the selected
 * photos, one chunk; returns what changed photos had, for 元に戻す.
 */
export const useBulkCamera = routeAction$(
  async (data, { platform, fail }) => {
    try {
      const previous = await setCameras(
        getDB(platform),
        data.ids,
        data.camera_id,
      );
      return { ok: true as const, previous };
    } catch (err) {
      if (err instanceof UnknownCameraError) {
        return fail(404, { message: "そのカメラはありません" });
      }
      throw err;
    }
  },
  zod$({
    ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
    camera_id: z.number().int().positive().nullable(),
  }),
);

/** Files view selection → プラットフォーム, one chunk; with the undo. */
export const useBulkPlatform = routeAction$(
  async (data, { platform }) => {
    const previous = await setPlatforms(
      getDB(platform),
      data.ids,
      data.platform,
    );
    return { ok: true as const, previous };
  },
  zod$({
    ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_IDS),
    platform: z.enum(PLATFORMS as [MediaPlatform, ...MediaPlatform[]]),
  }),
);

/** Undo of useBulkPlatform: each photo back to its platform. */
export const useRestorePlatform = routeAction$(
  async (data, { platform }) => {
    await restorePlatforms(getDB(platform), data.previous);
    return { ok: true as const };
  },
  zod$({
    previous: z
      .array(
        z.object({
          id: z.number().int().positive(),
          platform: z.enum(PLATFORMS as [MediaPlatform, ...MediaPlatform[]]),
        }),
      )
      .max(MAX_BULK_IDS),
  }),
);

/** Undo of useBulkCamera: each photo back to its camera. */
export const useRestoreCamera = routeAction$(
  async (data, { platform }) => {
    await restoreCameras(getDB(platform), data.previous);
    return { ok: true as const };
  },
  zod$({
    previous: z
      .array(
        z.object({
          id: z.number().int().positive(),
          camera_id: z.number().int().positive().nullable(),
          camera_source: z.enum(["manual", "file"]).nullable(),
        }),
      )
      .max(MAX_BULK_IDS),
  }),
);

/** Undo of useBulkMetadata. */
export const useRestoreMetadata = routeAction$(
  async (data, { platform }) => {
    // Written back as read: only valid overrides reach the column.
    const db = getDB(platform);
    await restoreMetadataLevels(
      db,
      data.previous.map((r) => ({
        id: r.id,
        levels: storedOverrides(parseOverrides(r.levels)),
      })),
    );
    await contentChanged(db);
    return { ok: true as const };
  },
  zod$({
    previous: z
      .array(
        z.object({
          id: z.number().int().positive(),
          levels: z.string().max(1000).nullable(),
        }),
      )
      .max(MAX_BULK_IDS),
  }),
);

/** Undo of useFolderOp: moves back, or a restore out of the trash. */
export const useUndoFolderOp = routeAction$(
  async (data, { platform, fail }) => {
    const db = getDB(platform);
    if (data.moves) {
      const r = await moveItems(db, data.moves);
      if (!r.ok) return fail(409, { message: r.error });
      await contentChanged(db);
    }
    if (data.restore) {
      for (const f of data.restore.folders) {
        const v = validateFolderPath(f);
        if (!v.ok) return fail(400, { message: `${f}: ${v.error}` });
      }
      try {
        const r = await restoreItems(
          db,
          data.restore.ids,
          data.restore.folders,
        );
        await contentChanged(db);
      } catch (err) {
        if (err instanceof RestoreError) {
          return fail(409, { message: err.message });
        }
        throw err;
      }
    }
    return { ok: true };
  },
  zod$({
    moves: z
      .array(
        z.union([
          z.object({
            kind: z.literal("photo"),
            id: z.number().int().positive(),
            to: z.string().max(600),
          }),
          z.object({
            kind: z.literal("folder"),
            from: z.string().max(600),
            to: z.string().max(600),
          }),
        ]),
      )
      .max(10_000)
      .optional(),
    restore: z
      .object({
        ids: z.array(z.number().int().positive()).max(10_000),
        folders: z.array(z.string().max(600)).max(10_000),
      })
      .optional(),
  }),
);

/**
 * Tick or untick every photo checkbox of one layout. Only that layout's:
 * the other one is hidden but its checked boxes would still be submitted,
 * so unticking a row after "select all" would not take it out.
 */
const selectAll = (toggle: HTMLInputElement, layout: "table" | "phone") => {
  toggle.form
    ?.querySelectorAll<HTMLInputElement>(
      `input[name="ids[]"][data-layout="${layout}"]`,
    )
    .forEach((cb) => (cb.checked = toggle.checked));
};

const BULK_FORM_ID = "bulk-form";

/** Phone card checkboxes of the bulk form. */
const phoneBoxes = (form: HTMLFormElement) =>
  Array.from(
    form.querySelectorAll<HTMLInputElement>(
      'input[name="ids[]"][data-layout="phone"]',
    ),
  );

// Folder (muted) + basename. Rendered as two adjacent text nodes so the
// element's text is still the full path (search / E2E match on it).
const FileName = component$<{ file: string; stacked?: boolean }>(
  ({ file, stacked }) => {
    const { dir, base } = splitPath(file);
    return (
      <span class={stacked ? "flex min-w-0 flex-col" : "block min-w-0"}>
        {stacked ? (
          <>
            <span class="truncate font-medium">{base}</span>
            <span class={["truncate text-xs", muted]}>{dir}</span>
          </>
        ) : (
          <span class="block truncate">
            <span class={["text-xs", muted]}>{dir}</span>
            <span class="font-medium">{base}</span>
          </span>
        )}
      </span>
    );
  },
);

// Chips for sighted users; the visually-hidden ", " keeps the text content
// a readable list for screen readers (and text matching).
const Tags = component$<{ tags: string[] }>(({ tags }) =>
  tags.length === 0 ? (
    <span class={muted}>—</span>
  ) : (
    <span class="flex flex-wrap gap-1">
      {tags.map((t, i) => (
        <span key={`${i}:${t}`} class={tagChip}>
          {t}
          {i < tags.length - 1 && <span class="sr-only">, </span>}
        </span>
      ))}
    </span>
  ),
);

export default component$(() => {
  const data = useMediaList();
  const bulk = useBulkVisibility();
  const restore = useRestoreVisibility();
  const newFolder = useCreateFolder();
  const toast = useSignal<ToastState | null>(null);
  const folderOp = useFolderOp();
  const undoFolderOp = useUndoFolderOp();
  /** What 元に戻す undoes after a folder rename / trash. */
  const lastFolderUndo = useSignal<{
    /** The folder it was, opened again once undone. */
    back: string;
    moves?: Move[];
    restore?: { ids: number[]; folders: string[] };
  } | null>(null);
  const renameOpen = useSignal(false);
  /** The last bulk change (its target and previous visibilities), for undo. */
  const lastChange = useSignal<{
    from: Visibility;
    changes: VisibilityChange[];
  } | null>(null);
  /** The last bulk metadata change (what the photos had), for undo. */
  const lastMetadata = useSignal<StoredLevels[] | null>(null);
  const moveSelection = useMoveSelection();
  const trashSelection = useTrashSelection();
  const renameItem = useRenameItem();
  const bulkMetadata = useBulkMetadata();
  const restoreMetadata = useRestoreMetadata();
  const selectionVisibility = useSelectionVisibility();
  const bulkCamera = useBulkCamera();
  const restoreCamera = useRestoreCamera();
  const bulkPlatform = useBulkPlatform();
  const restorePlatform = useRestorePlatform();
  /** The last bulk platform change (what the photos had), for undo. */
  const lastPlatform = useSignal<PreviousPlatform[] | null>(null);
  /** The last bulk camera change (what the photos had), for undo. */
  const lastCamera = useSignal<PreviousCamera[] | null>(null);
  /** A selection action going through in chunks: photos done of total. */
  const progress = useSignal<{ done: number; total: number } | null>(null);
  /** The Files view's selection actions; true when it went through. */
  const onSelection = $(
    async (a: SelectionAction, items: SelectedItems): Promise<boolean> => {
      const back =
        data.value.kind === "ok" && data.value.files
          ? data.value.files.dir
          : "/";
      if (
        a.kind === "metadata" ||
        a.kind === "visibility" ||
        a.kind === "camera" ||
        a.kind === "platform"
      ) {
        // Any number of photos, MAX_BULK_IDS per request, one after
        // another; the bar shows how far it got. A failure stops there
        // and keeps the undo of what went through.
        const total = items.photos.length;
        progress.value = { done: 0, total };
        const previous: StoredLevels[] = [];
        const changes: VisibilityChange[] = [];
        const cameras: PreviousCamera[] = [];
        const platforms: PreviousPlatform[] = [];
        let changed = 0;
        let error: string | null = null;
        let done = 0;
        for (const ids of inChunks(items.photos, MAX_BULK_IDS)) {
          try {
            const r =
              a.kind === "metadata"
                ? await bulkMetadata.submit({ ids, levels: a.levels })
                : a.kind === "camera"
                  ? await bulkCamera.submit({ ids, camera_id: a.cameraId })
                  : a.kind === "platform"
                    ? await bulkPlatform.submit({ ids, platform: a.platform })
                    : await selectionVisibility.submit({
                        ids,
                        visibility: a.visibility,
                      });
            if (r.value.failed) {
              error =
                ("message" in r.value ? String(r.value.message) : "") ||
                "失敗しました";
              break;
            }
            if (a.kind === "visibility" && "changed" in r.value) {
              changed += r.value.changed as number;
              changes.push(...(r.value.previous as VisibilityChange[]));
            } else if (a.kind === "camera") {
              cameras.push(...(r.value.previous as PreviousCamera[]));
            } else if (a.kind === "platform") {
              platforms.push(...(r.value.previous as PreviousPlatform[]));
            } else {
              previous.push(...(r.value.previous as StoredLevels[]));
            }
          } catch (err) {
            // Offline, or the server failed: what went through stays
            // undoable.
            error = err instanceof Error ? err.message : String(err);
            break;
          }
          done += ids.length;
          progress.value = { done, total };
        }
        progress.value = null;
        lastFolderUndo.value = null;
        lastMetadata.value =
          a.kind === "metadata" && previous.length > 0 ? previous : null;
        lastChange.value =
          a.kind === "visibility" && changes.length > 0
            ? { from: a.visibility, changes }
            : null;
        lastCamera.value =
          a.kind === "camera" && cameras.length > 0 ? cameras : null;
        lastPlatform.value =
          a.kind === "platform" && platforms.length > 0 ? platforms : null;
        const canUndo =
          lastMetadata.value !== null ||
          lastChange.value !== null ||
          lastCamera.value !== null ||
          lastPlatform.value !== null;
        const what =
          a.kind === "metadata"
            ? `${previous.length} 枚の公開する情報を変えました。`
            : a.kind === "platform"
              ? `${platforms.length} 枚を ${a.platform} にしました。`
              : a.kind === "camera"
                ? a.cameraName
                  ? `${cameras.length} 枚のカメラを「${a.cameraName}」にしました。`
                  : `${cameras.length} 枚のカメラを外しました。`
                : `${total} selected, ${changed} changed to ${VISIBILITY_LABELS[a.visibility]}.`;
        toast.value = error
          ? {
              tone: "error",
              message: `${done} / ${total} 枚まで反映しました (${what}) 残りは失敗: ${error}`,
              actionLabel: canUndo ? "元に戻す" : undefined,
            }
          : {
              tone: "success",
              message: what,
              actionLabel: canUndo ? "元に戻す" : undefined,
            };
        return error === null;
      }
      lastMetadata.value = null;
      lastCamera.value = null;
      lastPlatform.value = null;
      if (a.kind === "rename") {
        const r = await renameItem.submit({
          photo: items.photos[0],
          folder: items.folders[0],
          name: a.name,
        });
        if (r.value.failed) {
          toast.value = {
            tone: "error",
            message: r.value.message ?? "名前を変えられませんでした",
          };
          return false;
        }
        lastChange.value = null;
        lastFolderUndo.value =
          r.value.undo.length > 0 ? { back, moves: r.value.undo } : null;
        toast.value = {
          tone: "success",
          message: `${r.value.name} に名前を変えました。`,
          actionLabel: lastFolderUndo.value ? "元に戻す" : undefined,
        };
        return true;
      }
      if (a.kind === "move") {
        const r = await moveSelection.submit({
          dest: a.dest,
          name: a.name,
          ...items,
        });
        if (r.value.failed) {
          toast.value = {
            tone: "error",
            message: r.value.message ?? "移動できませんでした",
          };
          return false;
        }
        lastChange.value = null;
        lastFolderUndo.value = { back, moves: r.value.undo };
        toast.value = {
          tone: "success",
          message: `${r.value.count} 件を ${r.value.to} に移動しました。`,
          actionLabel: r.value.undo.length > 0 ? "元に戻す" : undefined,
        };
        return true;
      }
      if (a.kind === "trash") {
        const r = await trashSelection.submit(items);
        if (r.value.failed) {
          toast.value = {
            tone: "error",
            message: "ゴミ箱に入れられませんでした",
          };
          return false;
        }
        lastChange.value = null;
        const { ids, folders } = r.value.trashed;
        // Already gone (e.g. from another tab): nothing to put back.
        lastFolderUndo.value =
          ids.length + folders.length > 0
            ? { back, restore: r.value.trashed }
            : null;
        toast.value = {
          tone: "success",
          message: `${items.photos.length + items.folders.length} 件をゴミ箱に入れました。`,
          actionLabel: lastFolderUndo.value ? "元に戻す" : undefined,
        };
        return true;
      }
      return false;
    },
  );
  const refresh = useRefresh();
  const deleteIncomplete = useDeleteIncomplete();
  const uploader = useUploader($(() => refresh.submit()));
  const deleteIncompleteUpload$ = $(async (id: number) => {
    const res = await deleteIncomplete.submit({ id });
    if (res.value.failed) {
      toast.value = {
        tone: "error",
        message: res.value.message ?? "削除できませんでした",
      };
    }
  });
  // After an upload: the photos are private; one tap makes them visible
  // (through the bulk action, so its toast and undo apply).
  const setUploadedVisibility = $((ids: number[], v: Visibility) =>
    bulk.submit({ ids: ids.map(String), visibility: v }),
  );
  const newFolderOpen = useSignal(false);
  const nav = useNavigate();
  const loc = useLocation();
  // Back from an edit page (#m-<id>): bring that photo's row, card or tile
  // (whichever layout is shown) into view and flash it.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const id = parseMediaAnchor(track(() => loc.url.hash));
    if (id === null) return;
    // After the router's own scroll handling for the navigation.
    requestAnimationFrame(() => {
      const el = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-media-id="${id}"]`),
      ).find((e) => e.getClientRects().length > 0);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.dataset.flash = "";
      setTimeout(() => delete el.dataset.flash, 1600);
    });
  });
  // Phones: the filter form in a modal <dialog> shown as a bottom sheet
  // (showModal: focus moves in and is trapped, Escape closes, focus goes
  // back to the 絞り込み button). From sm up the same dialog is styled
  // inline and never opened as a modal.
  const sheet = useSignal<HTMLDialogElement>();
  const sheetTrigger = useSignal<HTMLButtonElement>();
  const closeSheet = $(() => {
    if (sheet.value?.open) sheet.value.close();
  });
  /**
   * Apply the filter form in place. In the sheet a select applies as soon
   * as it changes (a phone's picker commits once; the sheet stays open for
   * the next one); submitting (Filter, or Enter in the search box) also
   * closes the sheet.
   */
  const applyFilter = $(async (form: HTMLFormElement, close = false) => {
    const get = (name: string) => {
      const v = new FormData(form).get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    await nav(
      mediaListHref({
        view: parseView(get("view")),
        dir: get("dir") || null,
        platform: get("platform") || null,
        visibility: get("visibility") || null,
        q: get("q") || null,
        date: get("date") || null,
      }),
    );
    if (close) await closeSheet();
  });
  /**
   * A select changed: apply at once only in the phone sheet. On a desktop
   * a closed select also fires `change` for every arrow-key step, so there
   * the Filter button (or Enter) applies.
   */
  const selectChanged = $((select: HTMLSelectElement) => {
    if (select.form && sheet.value?.open) return applyFilter(select.form);
  });
  // Phones: ticked cards, selection mode (a tap on a card ticks it) and the
  // visibility picked in the bottom bar ("" = none yet).
  const selectedCount = useSignal(0);
  const selecting = useSignal(false);
  const phoneVisibility = useSignal<Visibility | "">("");
  /** `<view>:<page>` the selection state belongs to. */
  const shownPage = useSignal(
    data.value.kind === "ok" ? `${data.value.view}:${data.value.page}` : "",
  );

  useTask$(({ track }) => {
    const v = track(() => bulk.value);
    if (!v) return;
    if (v.failed) {
      toast.value = {
        tone: "error",
        message: v.message ?? "Bulk change failed",
      };
      return;
    }
    lastChange.value = { from: v.visibility, changes: v.previous };
    lastFolderUndo.value = null;
    lastMetadata.value = null;
    lastCamera.value = null;
    lastPlatform.value = null;
    toast.value = {
      tone: "success",
      message: `${v.selected} selected, ${v.changed} changed to ${VISIBILITY_LABELS[v.visibility]}.`,
      actionLabel: v.previous.length > 0 ? "元に戻す" : undefined,
    };
  });
  useTask$(({ track }) => {
    const v = track(() => restore.value);
    // A failure is reported by undo(), which keeps what is left to retry.
    if (!v || v.failed) return;
    toast.value = { tone: "success", message: "元に戻しました。" };
  });
  useTask$(({ track }) => {
    // Another folder (e.g. the one just created): the form starts closed.
    track(() => data.value.kind === "ok" && data.value.files?.dir);
    newFolderOpen.value = false;
  });
  useTask$(({ track }) => {
    // Success redirects into the new folder; only failures land here.
    const v = track(() => newFolder.value);
    if (v?.failed) {
      toast.value = {
        tone: "error",
        message:
          v.message ?? v.fieldErrors?.name ?? "フォルダを作れませんでした",
      };
    }
  });
  useTask$(({ track }) => {
    const v = track(() => folderOp.value);
    if (!v) return;
    if (v.failed) {
      toast.value = { tone: "error", message: v.message ?? "失敗しました" };
      return;
    }
    lastChange.value = null;
    lastMetadata.value = null;
    lastCamera.value = null;
    lastPlatform.value = null;
    lastFolderUndo.value = v.undo
      ? { back: v.from, moves: v.undo }
      : v.trashed
        ? { back: v.from, restore: v.trashed }
        : null;
    renameOpen.value = false;
    if (!isBrowser) return;
    toast.value = {
      tone: "success",
      message:
        v.op === "rename"
          ? `${v.to} に名前を変えました。`
          : "ゴミ箱に入れました。",
      actionLabel: "元に戻す",
    };
    void nav(mediaListHref({ view: "files", dir: v.to }));
  });
  useTask$(({ track }) => {
    const v = track(() => undoFolderOp.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: `元に戻せませんでした: ${v.message ?? ""}` }
      : { tone: "success", message: "元に戻しました。" };
  });
  const undo = $(async () => {
    const folderUndo = lastFolderUndo.value;
    if (folderUndo) {
      lastFolderUndo.value = null;
      const { back, ...undo } = folderUndo;
      const r = await undoFolderOp.submit(undo);
      if (!r.value.failed)
        await nav(mediaListHref({ view: "files", dir: back }));
      return;
    }
    const metadata = lastMetadata.value;
    if (metadata) {
      lastMetadata.value = null;
      // In the same chunks as the change; on a failure the rest stays to
      // try again.
      const chunks = inChunks(metadata, MAX_BULK_IDS);
      for (const [i, previous] of chunks.entries()) {
        const r = await restoreMetadata.submit({ previous }).catch(() => null);
        if (!r || r.value.failed) {
          lastMetadata.value = chunks.slice(i).flat();
          toast.value = {
            tone: "error",
            message: `元に戻せませんでした (${i * MAX_BULK_IDS} / ${metadata.length} 枚は戻しました)`,
            actionLabel: "元に戻す",
          };
          return;
        }
      }
      toast.value = { tone: "success", message: "元に戻しました。" };
      return;
    }
    const camera = lastCamera.value;
    if (camera) {
      lastCamera.value = null;
      const chunks = inChunks(camera, MAX_BULK_IDS);
      for (const [i, previous] of chunks.entries()) {
        const r = await restoreCamera.submit({ previous }).catch(() => null);
        if (!r || r.value.failed) {
          lastCamera.value = chunks.slice(i).flat();
          toast.value = {
            tone: "error",
            message: `元に戻せませんでした (${i * MAX_BULK_IDS} / ${camera.length} 枚は戻しました)`,
            actionLabel: "元に戻す",
          };
          return;
        }
      }
      toast.value = { tone: "success", message: "元に戻しました。" };
      return;
    }
    const platformUndo = lastPlatform.value;
    if (platformUndo) {
      lastPlatform.value = null;
      const chunks = inChunks(platformUndo, MAX_BULK_IDS);
      for (const [i, previous] of chunks.entries()) {
        const r = await restorePlatform.submit({ previous }).catch(() => null);
        if (!r || r.value.failed) {
          lastPlatform.value = chunks.slice(i).flat();
          toast.value = {
            tone: "error",
            message: `元に戻せませんでした (${i * MAX_BULK_IDS} / ${platformUndo.length} 枚は戻しました)`,
            actionLabel: "元に戻す",
          };
          return;
        }
      }
      toast.value = { tone: "success", message: "元に戻しました。" };
      return;
    }
    const last = lastChange.value;
    if (!last || last.changes.length === 0) return;
    lastChange.value = null;
    // The restore task reports each chunk; on a failure the rest stays.
    const chunks = inChunks(last.changes, MAX_BULK_IDS);
    for (const [i, changes] of chunks.entries()) {
      const r = await restore
        .submit({ from: last.from, changes })
        .catch(() => null);
      if (!r || r.value.failed) {
        lastChange.value = { from: last.from, changes: chunks.slice(i).flat() };
        toast.value = {
          tone: "error",
          message: `元に戻せませんでした (${i * MAX_BULK_IDS} / ${last.changes.length} 枚は戻しました)`,
          actionLabel: "元に戻す",
        };
        return;
      }
    }
  });

  /** Sync the phone selection state with the ticked boxes. */
  const recount = $((form: HTMLFormElement | null) => {
    const n = form ? phoneBoxes(form).filter((b) => b.checked).length : 0;
    selectedCount.value = n;
    if (n === 0) phoneVisibility.value = "";
  });
  const setAllPhone = $((form: HTMLFormElement | null, checked: boolean) => {
    if (form) for (const b of phoneBoxes(form)) b.checked = checked;
    return recount(form);
  });
  // Another page or a reloaded list (e.g. after an undo) renders other
  // boxes: recount once they are in the DOM, and leave selection mode when
  // the page changed.
  useTask$(({ track }) => {
    const list = track(() => data.value);
    if (!isBrowser) return;
    const page = list.kind === "ok" ? `${list.view}:${list.page}` : "";
    if (page !== shownPage.value) {
      shownPage.value = page;
      selecting.value = false;
    }
    requestAnimationFrame(() =>
      recount(document.getElementById(BULK_FORM_ID) as HTMLFormElement | null),
    );
  });
  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const {
    view,
    rows,
    total,
    page,
    platform,
    visibility,
    q,
    date,
    imageBase,
    files,
  } = data.value;
  const pageCount = lastPage(total, PAGE_SIZE);
  const filtered = Boolean(platform || visibility || q || date);
  const chips = filterChips({
    view,
    dir: files?.dir ?? "/",
    platform,
    visibility,
    q,
    date,
    visibilityLabel: (v) => (isVisibility(v) ? VISIBILITY_LABELS[v] : v),
  });
  const dir = files?.dir ?? "/";
  const pageUrl = (p: number) =>
    mediaListHref({ platform, visibility, q, date, page: p });
  // This list's own URL, so an edit page can link back to it.
  const back = pageUrl(page);
  // Phones: once something is ticked, a tap on a card ticks it too.
  const selectionMode = selecting.value || selectedCount.value > 0;
  const cardBody = (row: MediaRow) => (
    <>
      <Thumb
        file={row.file}
        platform={row.platform}
        imageBase={imageBase}
        variant="list"
        class="w-24 rounded-md"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-start justify-between gap-3">
          <FileName file={row.path} stacked />
          <span class={["shrink-0 text-xs tabular-nums", muted]}>
            #{row.id}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span class={platformBadge(row.platform)}>{row.platform}</span>
          <VisibilityBadge visibility={row.visibility} />
          <span class="tabular-nums">{formatJst(row.timestamp) ?? "—"}</span>
          {row.tags.length > 0 && <Tags tags={row.tags} />}
        </div>
      </div>
    </>
  );
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + rows.length;
  // Switching keeps the filter; the folder is remembered only in files view.
  const viewTabs: { view: MediaView; label: string; href: string }[] = [
    {
      view: "list",
      label: "List",
      href: mediaListHref({ platform, visibility, q, date }),
    },
    {
      view: "files",
      label: "Files",
      href: mediaListHref({
        view: "files",
        dir,
        platform,
        visibility,
        q,
        date,
      }),
    },
  ];

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Media <span class={["font-normal", muted]}>({total})</span>
        </h1>
        <div class="flex flex-wrap items-center gap-3">
          <p class={["text-sm", muted]}>
            {view === "files"
              ? "Open a photo to edit its metadata."
              : "Open a photo to edit its metadata. Times are JST."}
          </p>
          <nav
            aria-label="View"
            class="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {viewTabs.map((t) => (
              <Link
                prefetch="js"
                // Keyed by href: Qwik City's Link keeps the href it was
                // first rendered with, and filters apply without leaving
                // this route.
                key={t.href}
                href={t.href}
                aria-current={t.view === view ? "page" : undefined}
                class={[
                  "inline-flex h-11 items-center rounded-md px-4 font-medium sm:h-auto sm:px-3 sm:py-1",
                  t.view === view
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                ]}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Phones: the filter form is a bottom sheet behind this chip, and
          the active filters are chips that each remove themselves. */}
      <div class="-mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:hidden">
        <button
          ref={sheetTrigger}
          type="button"
          aria-haspopup="dialog"
          aria-controls="media-filter-sheet"
          data-js-only
          onClick$={() => {
            const d = sheet.value;
            if (!d) return;
            d.showModal();
            // Turned to a wider layout while open: the form is inline there.
            const wide = matchMedia("(min-width: 40rem)");
            const onWide = () => wide.matches && d.close();
            wide.addEventListener("change", onWide);
            d.addEventListener(
              "close",
              () => wide.removeEventListener("change", onWide),
              { once: true },
            );
          }}
          class={[
            buttonSecondary,
            "shrink-0 rounded-full",
            chips.length > 0 &&
              "border-sky-500 text-sky-800 dark:border-sky-500 dark:text-sky-300",
          ]}
        >
          絞り込み{chips.length > 0 && ` (${chips.length})`}
        </button>
        {chips.map((c) => (
          <Link
            prefetch="js"
            key={c.href}
            href={c.href}
            aria-label={`${c.label} の絞り込みを外す`}
            class="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-sky-100 pr-3 pl-4 text-sm font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-100"
          >
            {c.label}
            <span aria-hidden="true" class="opacity-60">
              ✕
            </span>
          </Link>
        ))}
      </div>
      {/* sm and up: the form shows the other filters; the date (from the
          calendar) has no field, so it gets its chip here. */}
      {chips
        .filter((c) => c.key === "date")
        .map((c) => (
          <div key={c.href} class="hidden items-center gap-3 sm:flex">
            <Link
              prefetch="js"
              href={c.href}
              aria-label={`${c.label} の絞り込みを外す`}
              class="inline-flex h-9 items-center gap-1.5 rounded-full bg-sky-100 pr-3 pl-4 text-sm font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-100"
            >
              {c.label}
              <span aria-hidden="true" class="opacity-60">
                ✕
              </span>
            </Link>
            {date && (
              <Link
                prefetch="js"
                key={calendarHrefFor(date)}
                href={calendarHrefFor(date)}
                class="text-sm font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400"
              >
                カレンダーへ
              </Link>
            )}
          </div>
        ))}
      {/* Without JS the sheet cannot open: show the form inline on phones
          too, and drop the button that would open it. */}
      <noscript
        dangerouslySetInnerHTML={
          "<style>#media-filter-sheet{display:block}[data-js-only]{display:none}</style>"
        }
      />
      <dialog
        id="media-filter-sheet"
        ref={sheet}
        aria-labelledby="media-filter-title"
        // Focus back on the button that opened it (Escape, ✕, backdrop, or
        // after applying).
        onClose$={() => sheetTrigger.value?.focus()}
        // A tap on the backdrop (the dialog itself, outside the form).
        onClick$={(ev, el) => {
          if (ev.target === el) el.close();
        }}
        class={[
          // Laid out as a plain block in the page instead of the UA's
          // dialog box; shown (display) from sm up always, and below sm by
          // the <noscript> style. Closed and below sm with JS: hidden (the
          // UA style). (Vertical margins: left to the space-y-* stack.)
          "static mx-0 w-auto max-w-none bg-transparent p-0 text-inherit sm:block",
          // Opened as a modal (phones): a sheet along the bottom.
          "backdrop:bg-black/40 max-sm:open:fixed max-sm:open:inset-x-0 max-sm:open:top-auto max-sm:open:bottom-0 max-sm:open:m-0 max-sm:open:max-h-[85dvh] max-sm:open:w-full max-sm:open:max-w-none max-sm:open:overflow-y-auto max-sm:open:bg-transparent max-sm:open:p-0 max-sm:open:text-inherit",
        ]}
      >
        <form
          id="media-filter"
          method="get"
          action="/media/"
          role="search"
          aria-label="Filter"
          // With JS: apply in place (no full reload) and close the sheet.
          preventdefault:submit
          onSubmit$={(_, form) => applyFilter(form, true)}
          class={[
            card,
            "grid gap-3 p-4 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-end",
            "max-sm:in-open:rounded-b-none max-sm:in-open:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:in-open:shadow-2xl",
          ]}
        >
          <div class="flex items-center justify-between sm:hidden">
            <h2 id="media-filter-title" class="text-base font-semibold">
              絞り込み
            </h2>
            <button
              type="button"
              aria-label="閉じる"
              data-js-only
              onClick$={closeSheet}
              class="-mr-2 grid size-11 place-items-center rounded-lg"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {view === "files" && (
            <>
              <input type="hidden" name="view" value="files" />
              {dir !== "/" && <input type="hidden" name="dir" value={dir} />}
            </>
          )}
          {/* From the calendar; dropped with its chip. */}
          {date && <input type="hidden" name="date" value={date} />}
          <div>
            <label for="filter-platform" class={label}>
              {PLATFORM_LABEL}
            </label>
            <select
              id="filter-platform"
              name="platform"
              onChange$={(_, el) => selectChanged(el)}
              class={field}
            >
              <option value="" selected={platform === null}>
                (any)
              </option>
              <option value="Real" selected={platform === "Real"}>
                Real
              </option>
              <option value="VRChat" selected={platform === "VRChat"}>
                VRChat
              </option>
            </select>
          </div>
          <div>
            <label for="filter-visibility" class={label}>
              Visibility
            </label>
            <select
              id="filter-visibility"
              name="visibility"
              onChange$={(_, el) => selectChanged(el)}
              class={field}
            >
              <option value="" selected={visibility === null}>
                (any)
              </option>
              {VISIBILITIES.map((v) => (
                <option key={v} value={v} selected={visibility === v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label for="filter-q" class={label}>
              File contains
            </label>
            <input
              id="filter-q"
              type="search"
              name="q"
              value={q}
              placeholder="e.g. 2023-12"
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              enterKeyHint="search"
              class={field}
            />
          </div>
          <div class="flex gap-2">
            <button type="submit" class={buttonPrimary}>
              Filter
            </button>
            {filtered && (
              <Link
                prefetch="js"
                key={mediaListHref({ view, dir })}
                href={mediaListHref({ view, dir })}
                class={buttonSecondary}
              >
                Reset
              </Link>
            )}
          </div>
        </form>
      </dialog>

      {/* Unfiltered, the files view stays up even with no photos: it is
          where the first folder is created. */}
      {total === 0 && !(files && !filtered) ? (
        filtered ? (
          <StatePanel
            tone="empty"
            level={2}
            title="No media match these filters"
            action={{
              href: mediaListHref({ view, dir }),
              label: "Clear filters",
            }}
          >
            <p>
              Nothing in D1 matches
              {[
                platform && ` platform “${platform}”`,
                visibility && ` visibility “${VISIBILITY_LABELS[visibility]}”`,
                q && ` a file path containing “${q}”`,
                date && ` taken on “${date}”`,
              ]
                .filter(Boolean)
                .join(" and")}
              .
            </p>
          </StatePanel>
        ) : (
          <StatePanel
            tone="empty"
            level={2}
            title="No media yet"
            action={{ href: "/", label: "Back to dashboard" }}
          >
            <p>
              The D1 database has no rows. Import the existing index with{" "}
              <code>pnpm import-media</code> and <code>pnpm db.seed.local</code>{" "}
              (see the admin README).
            </p>
          </StatePanel>
        )
      ) : view === "files" && files ? (
        <>
          {files.truncated && (
            <p role="status" class="text-sm text-amber-700 dark:text-amber-400">
              More than {FILES_LIMIT} files match: only the first {FILES_LIMIT}{" "}
              by path are in the tree. Narrow the filter to see the rest.
            </p>
          )}
          {/* Drops upload into the open folder (when uploads are on). */}
          <DropZone
            uploader={uploader}
            dir={files.dir}
            enabled={files.uploadEnabled}
            onProblem$={(message) => {
              toast.value = { tone: "error", message };
            }}
          >
            <FileBrowser
              tree={files.tree}
              dir={files.dir}
              folder={files.folder}
              files={files.files}
              imageBase={imageBase}
              platform={platform}
              visibility={visibility}
              q={q}
              date={date}
              siteDefaults={files.siteDefaults}
              cameras={files.cameras}
              progress={progress.value}
              onSelection$={onSelection}
            >
              <div q:slot="toolbar" class="max-sm:w-full">
                {newFolderOpen.value ? (
                  <Form
                    action={newFolder}
                    aria-busy={newFolder.isRunning}
                    aria-label="New folder"
                    class="flex items-center gap-2"
                  >
                    <input type="hidden" name="dir" value={dir} />
                    <label for="new-folder-name" class="sr-only">
                      Folder name
                    </label>
                    <input
                      id="new-folder-name"
                      name="name"
                      required
                      maxLength={MAX_FOLDER_NAME_LEN}
                      // Same rule as validateFolderName, which trims (and
                      // is what counts: the server checks again).
                      pattern={"\\s*[A-Za-z0-9_\\-][A-Za-z0-9._\\-]*\\s*"}
                      title="英数字と . _ - (先頭に . は不可)"
                      placeholder="2026-11"
                      autoFocus
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellcheck={false}
                      enterKeyHint="done"
                      class={[field, "min-w-0 flex-1 sm:w-48"]}
                    />
                    <SubmitButton
                      running={newFolder.isRunning}
                      class={buttonPrimary}
                    >
                      Create
                    </SubmitButton>
                    <button
                      type="button"
                      onClick$={() => (newFolderOpen.value = false)}
                      class={buttonSecondary}
                    >
                      Cancel
                    </button>
                  </Form>
                ) : renameOpen.value && dir !== "/" ? (
                  <Form
                    action={folderOp}
                    aria-busy={folderOp.isRunning}
                    aria-label="フォルダ名の変更"
                    class="flex items-center gap-2"
                  >
                    <input type="hidden" name="op" value="rename" />
                    <input type="hidden" name="dir" value={dir} />
                    <label for="rename-folder-name" class="sr-only">
                      新しい名前
                    </label>
                    <input
                      id="rename-folder-name"
                      name="name"
                      required
                      value={dir.slice(dir.lastIndexOf("/") + 1)}
                      maxLength={MAX_FOLDER_NAME_LEN}
                      pattern={"\\s*[A-Za-z0-9_\\-][A-Za-z0-9._\\-]*\\s*"}
                      title="英数字と . _ - (先頭に . は不可)"
                      autoFocus
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellcheck={false}
                      enterKeyHint="done"
                      class={[field, "min-w-0 flex-1 sm:w-48"]}
                    />
                    <SubmitButton
                      running={folderOp.isRunning}
                      class={buttonPrimary}
                    >
                      変更
                    </SubmitButton>
                    <button
                      type="button"
                      onClick$={() => (renameOpen.value = false)}
                      class={buttonSecondary}
                    >
                      Cancel
                    </button>
                  </Form>
                ) : (
                  <div class="flex flex-wrap gap-2">
                    {dir !== "/" && (
                      <>
                        <button
                          type="button"
                          onClick$={() => (renameOpen.value = true)}
                          class={[
                            buttonSecondary,
                            "min-w-fit whitespace-nowrap max-sm:flex-1",
                          ]}
                        >
                          名前を変更
                        </button>
                        <Form action={folderOp} class="contents">
                          <input type="hidden" name="op" value="trash" />
                          <input type="hidden" name="dir" value={dir} />
                          <SubmitButton
                            running={folderOp.isRunning}
                            class={[
                              buttonSecondary,
                              "min-w-fit whitespace-nowrap text-red-700 max-sm:flex-1 dark:text-red-400",
                            ]}
                          >
                            フォルダをゴミ箱へ
                          </SubmitButton>
                        </Form>
                      </>
                    )}
                    <Link
                      prefetch="js"
                      href="/media/trash/"
                      class={[
                        buttonSecondary,
                        "min-w-fit whitespace-nowrap max-sm:flex-1",
                      ]}
                    >
                      ゴミ箱
                    </Link>
                    <button
                      type="button"
                      onClick$={() => (newFolderOpen.value = true)}
                      class={[
                        buttonSecondary,
                        "min-w-fit whitespace-nowrap max-sm:flex-1",
                      ]}
                    >
                      <span aria-hidden="true">＋</span>
                      New folder
                    </button>
                    {files.uploadEnabled && (
                      <>
                        <UploadFolderButton
                          uploader={uploader}
                          dir={files.dir}
                        />
                        <UploadButton uploader={uploader} dir={files.dir} />
                      </>
                    )}
                  </div>
                )}
              </div>
              <div q:slot="panel" class="space-y-4">
                <UploadPanel
                  uploader={uploader}
                  onSetVisibility$={setUploadedVisibility}
                />
                <IncompleteUploads
                  rows={files.incomplete}
                  uploader={uploader}
                  onDelete$={deleteIncompleteUpload$}
                />
              </div>
            </FileBrowser>
          </DropZone>
        </>
      ) : (
        // Bulk change: tick photos (table rows or phone cards), pick a
        // visibility, Apply. Both layouts carry the checkboxes; the hidden
        // layout's stay unticked (each "select all" only touches its own
        // layout), and the action deduplicates the ids anyway. sm and up use
        // the bar above the table; phones the bar fixed at the bottom.
        <Form
          id={BULK_FORM_ID}
          action={bulk}
          aria-busy={bulk.isRunning}
          onChange$={(_, form) => recount(form)}
          // Applied: start over with nothing ticked.
          onSubmitCompleted$={(ev, form) => {
            const { value } = ev.detail as { value?: { ok?: boolean } };
            if (!value?.ok) return;
            form.reset();
            selectedCount.value = 0;
            selecting.value = false;
            phoneVisibility.value = "";
          }}
          class="space-y-3"
        >
          <div
            class={[
              card,
              "hidden flex-wrap items-center gap-3 px-4 py-3 text-sm sm:flex",
            ]}
          >
            <label for="bulk-visibility" class="font-medium">
              Set visibility of selected to
            </label>
            <div class="w-36">
              <select
                id="bulk-visibility"
                name="visibility"
                // The phone bar's choice is submitted instead.
                disabled={phoneVisibility.value !== ""}
                class={field}
              >
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton
              running={bulk.isRunning}
              pendingLabel="適用中…"
              class={buttonSecondary}
            >
              Apply
            </SubmitButton>
          </div>

          {/* sm and up: table. Every row is one link target (stretched link). */}
          <div class={[card, "hidden overflow-hidden sm:block"]}>
            <table class="w-full table-fixed text-left text-sm">
              <thead class="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" class="w-10 py-2.5 pl-4">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      data-testid="select-all"
                      onChange$={(_, el) => selectAll(el, "table")}
                    />
                  </th>
                  <th scope="col" class="w-14 px-4 py-2.5 font-medium">
                    ID
                  </th>
                  <th scope="col" class="w-[8.5rem] px-4 py-2.5 font-medium">
                    <span class="sr-only">Thumbnail</span>
                  </th>
                  <th scope="col" class="px-4 py-2.5 font-medium">
                    File
                  </th>
                  <th scope="col" class="w-28 px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" class="w-40 px-4 py-2.5 font-medium">
                    Taken
                  </th>
                  <th
                    scope="col"
                    class="hidden w-32 px-4 py-2.5 font-medium md:table-cell"
                  >
                    Tags
                  </th>
                  <th
                    scope="col"
                    class="hidden w-36 px-4 py-2.5 font-medium lg:table-cell"
                  >
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-media-id={row.id}
                    class="relative align-middle transition-colors hover:bg-sky-50/60 has-[a:focus-visible]:bg-sky-50/60 dark:hover:bg-sky-950/30 dark:has-[a:focus-visible]:bg-sky-950/30"
                  >
                    <td class="py-3 pl-4">
                      {/* Above the row's stretched link. */}
                      <input
                        type="checkbox"
                        name="ids[]"
                        data-layout="table"
                        value={String(row.id)}
                        aria-label={`Select #${row.id}`}
                        class="relative z-10"
                      />
                    </td>
                    <td class={["px-4 py-3 tabular-nums", muted]}>{row.id}</td>
                    <td class="px-4 py-2">
                      <Thumb
                        file={row.file}
                        platform={row.platform}
                        imageBase={imageBase}
                        variant="list"
                        class="h-14 rounded-md"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <Link
                        prefetch="js"
                        key={back}
                        href={mediaEditHref(row.id, back)}
                        title={row.path}
                        class="block min-w-0 rounded after:absolute after:inset-0 after:content-['']"
                      >
                        <FileName file={row.path} />
                      </Link>
                    </td>
                    <td class="px-4 py-3">
                      <span class="flex flex-col items-start gap-1">
                        <span class={platformBadge(row.platform)}>
                          {row.platform}
                        </span>
                        <VisibilityBadge visibility={row.visibility} />
                      </span>
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap tabular-nums">
                      {formatJst(row.timestamp) ?? <span class={muted}>—</span>}
                    </td>
                    <td class="hidden px-4 py-3 md:table-cell">
                      <Tags tags={row.tags} />
                    </td>
                    <td
                      class={[
                        "hidden px-4 py-3 text-xs whitespace-nowrap tabular-nums lg:table-cell",
                        muted,
                      ]}
                    >
                      {formatJst(row.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Below sm: stacked cards, no horizontal overflow. The whole left
              column of a card is the checkbox's hit area, so a tap meant
              for it never opens the photo. In selection mode a tap anywhere
              on the card ticks it instead. */}
          <div class="flex items-center justify-between gap-3 sm:hidden">
            <p class={["text-sm", muted]}>
              {selectionMode ? "タップして選択" : "左端のチェックで選択"}
            </p>
            <button
              type="button"
              onClick$={(_, el) => {
                if (selectionMode) {
                  setAllPhone(el.form, false);
                  selecting.value = false;
                } else {
                  selecting.value = true;
                }
              }}
              class={buttonSecondary}
            >
              {selectionMode ? "完了" : "選択"}
            </button>
          </div>
          <ul
            class={[
              card,
              "divide-y divide-zinc-100 overflow-hidden sm:hidden dark:divide-zinc-800",
            ]}
          >
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="media-card"
                data-media-id={row.id}
                class="flex items-stretch has-checked:bg-sky-50 has-checked:ring-2 has-checked:ring-sky-500 has-checked:ring-inset dark:has-checked:bg-sky-950/40"
              >
                <label class="flex w-14 shrink-0 cursor-pointer items-start justify-center pt-3.5 pl-1">
                  <input
                    type="checkbox"
                    id={`pick-${row.id}`}
                    name="ids[]"
                    data-layout="phone"
                    value={String(row.id)}
                    aria-label={`Select #${row.id}`}
                    class="size-5 accent-sky-600"
                  />
                </label>
                {selectionMode ? (
                  <label
                    for={`pick-${row.id}`}
                    title={row.path}
                    class="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3 pr-4 pl-1 select-none"
                  >
                    {cardBody(row)}
                  </label>
                ) : (
                  <Link
                    prefetch="js"
                    key={back}
                    href={mediaEditHref(row.id, back)}
                    title={row.path}
                    class="flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 pl-1 active:bg-sky-50 dark:active:bg-sky-950/30"
                  >
                    {cardBody(row)}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          {selectedCount.value > 0 && (
            <div
              data-bottom-bar
              role="region"
              aria-label="選択した写真"
              class="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-zinc-200 bg-white/95 pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-4px_12px_rgb(0_0_0/0.06)] backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-900/95"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm font-semibold" data-testid="selection-count">
                  {selectedCount.value} 件選択
                </p>
                <button
                  type="button"
                  onClick$={(_, el) =>
                    setAllPhone(el.form, selectedCount.value < rows.length)
                  }
                  class="h-11 rounded-lg px-2 text-sm font-medium text-sky-700 dark:text-sky-400"
                >
                  {selectedCount.value < rows.length
                    ? "すべて選択"
                    : "選択解除"}
                </button>
              </div>
              <div class="flex items-stretch gap-2">
                <fieldset class="grid min-w-0 flex-1 grid-cols-3 rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
                  <legend class="sr-only">公開範囲</legend>
                  {VISIBILITIES.map((v) => (
                    <label
                      key={v}
                      // Each level's icon and colour (visibility-style.tsx);
                      // the chosen one filled in its style.
                      class={[
                        "flex h-10 cursor-pointer items-center justify-center gap-1 rounded-md text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-sky-500",
                        phoneVisibility.value === v
                          ? [VISIBILITY_STYLE[v].selected, "ring-2 ring-inset"]
                          : VISIBILITY_STYLE[v].accent,
                      ]}
                    >
                      <input
                        type="radio"
                        name="visibility"
                        value={v}
                        checked={phoneVisibility.value === v}
                        onChange$={() => (phoneVisibility.value = v)}
                        class="sr-only"
                      />
                      <VisibilityIcon visibility={v} />
                      {VISIBILITY_LABELS_JA[v]}
                    </label>
                  ))}
                </fieldset>
                <SubmitButton
                  running={bulk.isRunning}
                  disabled={phoneVisibility.value === ""}
                  class={buttonPrimary}
                >
                  適用
                </SubmitButton>
              </div>
            </div>
          )}
        </Form>
      )}

      {total > 0 && view === "list" && (
        <nav
          aria-label="Pagination"
          class="flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          <p class={muted}>
            {from}–{to} of {total} · Page {page} / {pageCount}
          </p>
          <div class="flex gap-2">
            {page > 1 && (
              <Link
                prefetch="js"
                key={pageUrl(page - 1)}
                href={pageUrl(page - 1)}
                class={buttonSecondary}
              >
                ← Prev
              </Link>
            )}
            {page < pageCount && (
              <Link
                prefetch="js"
                key={pageUrl(page + 1)}
                href={pageUrl(page + 1)}
                class={buttonSecondary}
              >
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
      <Toast toast={toast} onAction$={undo} />
    </div>
  );
});

export const head: DocumentHead = {
  title: "Media — Admin",
};
