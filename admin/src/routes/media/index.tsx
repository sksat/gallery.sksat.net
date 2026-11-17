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
  visibilityBadge,
  worldBadge,
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
import { FileBrowser, type FileTile } from "~/components/file-browser";
import { SubmitButton } from "~/components/submit-button";
import { Thumb } from "~/components/thumb";
import { Toast, type ToastState } from "~/components/toast";
import { getDB, getImageBase } from "~/lib/env";
import {
  buildFolderTree,
  dirOf,
  filesInDir,
  findFolder,
  MAX_FOLDER_NAME_LEN,
  newFolderPath,
  normalizeDir,
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
  splitPath,
  type MediaView,
} from "~/lib/format";
import {
  isVisibility,
  VISIBILITIES,
  type MediaRow,
  type MediaWorld,
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
 * id/file/world. Far above today's size; past it the tree is incomplete
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
};

type MediaListResult =
  | {
      kind: "ok";
      view: MediaView;
      rows: MediaRow[];
      total: number;
      page: number;
      world: MediaWorld | null;
      visibility: Visibility | null;
      q: string;
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
    const worldRaw = query.get("world");
    const world: MediaWorld | undefined =
      worldRaw === "Real" || worldRaw === "VRChat" ? worldRaw : undefined;
    const visibilityRaw = query.get("visibility");
    const visibility = isVisibility(visibilityRaw) ? visibilityRaw : undefined;
    const q = query.get("q")?.trim() || undefined;
    const imageBase = getImageBase(platform);

    if (parseView(query.get("view")) === "files") {
      const { rows, truncated } = await listMediaFiles(db, {
        world,
        visibility,
        q,
        limit: FILES_LIMIT,
      });
      const dir = normalizeDir(query.get("dir"));
      // Empty folders only when unfiltered: a filter shows where the
      // matching photos are.
      const folders = world || visibility || q ? [] : await listFolders(db);
      const tree = buildFolderTree(
        rows.map((r) => r.file),
        folders,
      );
      return {
        kind: "ok",
        view: "files",
        rows: [],
        total: rows.length,
        page: 1,
        world: world ?? null,
        visibility: visibility ?? null,
        q: q ?? "",
        imageBase,
        files: {
          tree,
          dir,
          folder: findFolder(tree, dir),
          files: filesInDir(rows, dir),
          truncated,
          // Both halves: the presigned PUT and the check that completes it.
          uploadEnabled:
            getUploadConfig(platform) !== null &&
            getObjectStat(platform, url, null) !== null,
          incomplete: (await listIncompleteUploads(db)).filter(
            (u) => dirOf(u.file) === dir,
          ),
        },
      };
    }

    const pageRaw = Number(query.get("page") ?? "1");
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const offset = (page - 1) * PAGE_SIZE;

    const { rows, total } = await listMedia(db, {
      world,
      visibility,
      q,
      limit: PAGE_SIZE,
      offset,
    });
    // Past the end (stale link, or a filter that shrank the result): send
    // the user to the last page that has rows instead of "Page 2 / 1".
    if (rows.length === 0 && page > 1) {
      throw redirect(
        302,
        mediaListHref({
          world,
          visibility,
          q,
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
      world: world ?? null,
      visibility: visibility ?? null,
      q: q ?? "",
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
    return {
      ok: true,
      changed: await restoreVisibility(db, data.from, v.groups),
    };
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
      return fail(500, { message: "D1 binding unavailable" });
    }
    if (!(await deleteIncompleteUpload(db, data.id))) {
      return fail(404, { message: "未完了のアップロードが見つかりません" });
    }
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

/** Short labels for the phone selection bar. */
const VISIBILITY_LABELS_JA: Record<Visibility, string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

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
        world: get("world") || null,
        visibility: get("visibility") || null,
        q: get("q") || null,
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
  /** The last bulk change (its target and previous visibilities), for undo. */
  const lastChange = useSignal<{
    from: Visibility;
    changes: VisibilityChange[];
  } | null>(null);
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
    toast.value = {
      tone: "success",
      message: `${v.selected} selected, ${v.changed} changed to ${VISIBILITY_LABELS[v.visibility]}.`,
      actionLabel: v.previous.length > 0 ? "元に戻す" : undefined,
    };
  });
  useTask$(({ track }) => {
    const v = track(() => restore.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: `Undo failed: ${v.message ?? "error"}` }
      : { tone: "success", message: "元に戻しました。" };
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
  const undo = $(async () => {
    const last = lastChange.value;
    if (!last || last.changes.length === 0) return;
    lastChange.value = null;
    await restore.submit(last);
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
  const { view, rows, total, page, world, visibility, q, imageBase, files } =
    data.value;
  const pageCount = lastPage(total, PAGE_SIZE);
  const filtered = Boolean(world || visibility || q);
  const chips = filterChips({
    view,
    dir: files?.dir ?? "/",
    world,
    visibility,
    q,
    visibilityLabel: (v) => (isVisibility(v) ? VISIBILITY_LABELS[v] : v),
  });
  const dir = files?.dir ?? "/";
  const pageUrl = (p: number) =>
    mediaListHref({ world, visibility, q, page: p });
  // This list's own URL, so an edit page can link back to it.
  const back = pageUrl(page);
  // Phones: once something is ticked, a tap on a card ticks it too.
  const selectionMode = selecting.value || selectedCount.value > 0;
  const cardBody = (row: MediaRow) => (
    <>
      <Thumb
        file={row.file}
        world={row.world}
        imageBase={imageBase}
        variant="list"
        class="w-24 rounded-md"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-start justify-between gap-3">
          <FileName file={row.file} stacked />
          <span class={["shrink-0 text-xs tabular-nums", muted]}>
            #{row.id}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span class={worldBadge(row.world)}>{row.world}</span>
          <span class={visibilityBadge(row.visibility)}>
            {VISIBILITY_LABELS[row.visibility]}
          </span>
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
      href: mediaListHref({ world, visibility, q }),
    },
    {
      view: "files",
      label: "Files",
      href: mediaListHref({ view: "files", dir, world, visibility, q }),
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
          <div>
            <label for="filter-world" class={label}>
              World
            </label>
            <select
              id="filter-world"
              name="world"
              onChange$={(_, el) => selectChanged(el)}
              class={field}
            >
              <option value="" selected={world === null}>
                (any)
              </option>
              <option value="Real" selected={world === "Real"}>
                Real
              </option>
              <option value="VRChat" selected={world === "VRChat"}>
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
                world && ` world “${world}”`,
                visibility && ` visibility “${VISIBILITY_LABELS[visibility]}”`,
                q && ` a file path containing “${q}”`,
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
              world={world}
              visibility={visibility}
              q={q}
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
                ) : (
                  <div class="flex flex-wrap gap-2">
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
                        world={row.world}
                        imageBase={imageBase}
                        variant="list"
                        class="h-14 rounded-md"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <Link
                        key={back}
                        href={mediaEditHref(row.id, back)}
                        title={row.file}
                        class="block min-w-0 rounded after:absolute after:inset-0 after:content-['']"
                      >
                        <FileName file={row.file} />
                      </Link>
                    </td>
                    <td class="px-4 py-3">
                      <span class="flex flex-col items-start gap-1">
                        <span class={worldBadge(row.world)}>{row.world}</span>
                        <span
                          data-testid="visibility-badge"
                          class={visibilityBadge(row.visibility)}
                        >
                          {VISIBILITY_LABELS[row.visibility]}
                        </span>
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
                    title={row.file}
                    class="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3 pr-4 pl-1 select-none"
                  >
                    {cardBody(row)}
                  </label>
                ) : (
                  <Link
                    key={back}
                    href={mediaEditHref(row.id, back)}
                    title={row.file}
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
                      class="grid h-10 cursor-pointer place-items-center rounded-md text-sm font-medium text-zinc-700 has-checked:bg-zinc-900 has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-sky-500 dark:text-zinc-300 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900"
                    >
                      <input
                        type="radio"
                        name="visibility"
                        value={v}
                        checked={phoneVisibility.value === v}
                        onChange$={() => (phoneVisibility.value = v)}
                        class="sr-only"
                      />
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
                key={pageUrl(page - 1)}
                href={pageUrl(page - 1)}
                class={buttonSecondary}
              >
                ← Prev
              </Link>
            )}
            {page < pageCount && (
              <Link
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
