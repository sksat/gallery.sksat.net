import {
  $,
  component$,
  Slot,
  sync$,
  useOnDocument,
  useSignal,
  useTask$,
  useVisibleTask$,
  type JSXOutput,
  type QRL,
} from "@builder.io/qwik";
import { Link, useNavigate } from "@builder.io/qwik-city";
import {
  DEFAULT_PREFS,
  moveFocus,
  parsePrefs,
  PREFS_KEY,
  SORT_KEYS,
  SORT_LABELS,
  sortFolders,
  sortPhotos,
  type SortKey,
  type ViewPrefs,
} from "~/lib/file-view";
import {
  ancestors,
  folderTotals,
  isWithin,
  type FolderNode,
} from "~/lib/folders";
import { formatJst, mediaEditHref, mediaListHref } from "~/lib/format";
import type { CameraChoice } from "~/lib/db-photo-bulk";
import type { MetadataLevels, MetadataOverrides } from "~/lib/metadata";
import {
  clickItem,
  EMPTY_SELECTION,
  folderKey,
  keepShown,
  reconcileSelection,
  photoKey,
  selectAll,
  splitSelection,
  type Selection,
  type SelKey,
} from "~/lib/selection";
import { formatDecimalBytes } from "~/lib/storage";
import { VISIBILITIES, type MediaPlatform, type Visibility } from "~/lib/types";
import { ContextMenu, type MenuItem } from "./context-menu";
import {
  SelectionBar,
  type BarCommand,
  type SelectionAction,
} from "./selection-bar";
import { StatePanel } from "./state-panel";
import { Thumb } from "./thumb";
import { VisibilityBadge } from "./visibility-badge";
import { VISIBILITY_LABELS_JA, VisibilityIcon } from "./visibility-style";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
  platformBadge,
} from "./ui";

// File-manager view of /media: the folder tree built from the file paths on
// the left (a disclosure on phones) and the open folder's subfolders and
// photos on the right, as tiles or as a list, in the order the viewer
// chose (remembered in localStorage). The contents are a multi-select
// listbox: a click opens (or, while something is selected, picks), the
// arrow keys move the focus (one tab stop), Space picks, Enter opens, F2
// renames, Delete trashes, the menu key / Shift+F10 / a right click opens
// a context menu, and selected tiles can be dragged onto a folder (tile
// or tree) to move them. On touch screens a long press starts selecting.

/** A photo tile: `path` places and names it, `file` is its thumbnail. */
export type FileTile = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: Visibility;
  size: number | null;
  /** When it was taken (ISO), if known. */
  timestamp: string | null;
  /** Its public metadata overrides (for a bulk change). */
  metadata: MetadataOverrides;
  /** Its camera, if any. */
  camera_id: number | null;
};

type Props = {
  tree: FolderNode;
  /** Selected folder (normalised, "/" = root). */
  dir: string;
  /** The selected folder, or null if no (filtered) file lives under dir. */
  folder: FolderNode | null;
  /** Photos directly in `dir`. */
  files: FileTile[];
  imageBase: string | null;
  platform: MediaPlatform | null;
  visibility: Visibility | null;
  q: string;
  /** Taken in this year, month or day (the calendar), or null. */
  date?: string | null;
  /** The site's metadata levels (what 既定 is in a bulk change). */
  siteDefaults: MetadataLevels;
  /** Registered cameras (the camera picker). */
  cameras: CameraChoice[];
  /** A chunked selection action under way (shown in the bar). */
  progress?: { done: number; total: number } | null;
  /**
   * Runs an action on the selection (move / rename / visibility /
   * metadata / trash); resolves true when it succeeded, so the selection
   * is cleared. Without it the tiles cannot be selected.
   */
  onSelection$?: QRL<
    (a: SelectionAction, items: SelectedItems) => Promise<boolean>
  >;
};

export type SelectedItems = { photos: number[]; folders: string[] };

const ROOT_LABEL = "All files";
/** How long a touch must be held to start selecting. */
const LONG_PRESS_MS = 450;

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** The tile an event is on. (Module level: handlers cannot capture it.) */
const itemOf = (t: EventTarget | null) =>
  (t as HTMLElement | null)?.closest?.<HTMLElement>("[data-sel-key]") ?? null;
const optionId = (key: SelKey) => `opt-${key}`;

/**
 * A tile's tick mark. Not a control of its own (the option carries the
 * state, aria-selected); a click on it picks the tile, a 44px target on
 * phones.
 */
const TickMark = ({ list }: { list?: boolean }) => (
  <span
    aria-hidden="true"
    data-tick
    data-testid="tile-check"
    class={[
      "z-10 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg sm:size-8",
      list ? "relative" : "absolute top-1 right-1",
      // Shown on hover (pointer devices), when selected, while selecting,
      // and always on touch screens.
      "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-aria-selected:opacity-100 [[data-selecting]_&]:opacity-100",
    ]}
  >
    <span
      class={[
        "flex size-6 items-center justify-center rounded-md border-2 shadow sm:size-5",
        list
          ? "border-zinc-400 group-aria-selected:border-sky-600 group-aria-selected:bg-sky-600 dark:border-zinc-500"
          : "border-white bg-black/30 group-aria-selected:border-sky-600 group-aria-selected:bg-sky-600",
      ]}
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        class="hidden size-4 text-white group-aria-selected:block"
      >
        <path
          fill-rule="evenodd"
          d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
          clip-rule="evenodd"
        />
      </svg>
    </span>
  </span>
);

const FolderIcon = ({ class: cls = "size-4" }: { class?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class={["shrink-0", cls]}
  >
    <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4.09a1.5 1.5 0 0 1 1.06.44L9.7 5.5h6.8A1.5 1.5 0 0 1 18 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-10Z" />
  </svg>
);

const Count = ({ n }: { n: number }) => (
  <span class={["ml-auto pl-2 text-xs tabular-nums", muted]}>
    {n}
    <span class="sr-only"> files</span>
  </span>
);

/** "12 / 40 公開 · 1.23 GB": public photos of all, and their size. */
const FolderStats = ({
  node,
  bytes,
}: {
  node: FolderNode;
  bytes?: boolean;
}) => (
  <span
    data-testid="folder-stats"
    class={["block text-xs tabular-nums", muted]}
  >
    <span
      class={
        folderTotals(node).publicCount > 0
          ? "font-medium text-sky-700 dark:text-sky-400"
          : undefined
      }
    >
      {folderTotals(node).publicCount} / {folderTotals(node).count} 公開
    </span>
    {bytes !== false && (
      <>
        {" · "}
        {formatDecimalBytes(folderTotals(node).bytes)}
      </>
    )}
  </span>
);

/** Links for すべて / 公開のみ / 非公開のみ (the visibility filter). */
const VISIBILITY_TABS: { label: string; value: Visibility | null }[] = [
  { label: "すべて", value: null },
  { label: "公開のみ", value: "public" },
  { label: "限定公開のみ", value: "unlisted" },
  { label: "非公開のみ", value: "private" },
];

const GRID_ICON =
  "M3 4.5A1.5 1.5 0 0 1 4.5 3h3A1.5 1.5 0 0 1 9 4.5v3A1.5 1.5 0 0 1 7.5 9h-3A1.5 1.5 0 0 1 3 7.5v-3Zm8 0A1.5 1.5 0 0 1 12.5 3h3A1.5 1.5 0 0 1 17 4.5v3A1.5 1.5 0 0 1 15.5 9h-3A1.5 1.5 0 0 1 11 7.5v-3Zm-8 8A1.5 1.5 0 0 1 4.5 11h3A1.5 1.5 0 0 1 9 12.5v3A1.5 1.5 0 0 1 7.5 17h-3A1.5 1.5 0 0 1 3 15.5v-3Zm8 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z";
const LIST_ICON =
  "M3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm1 4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H4Z";

const Icon = ({ d, class: cls = "size-4" }: { d: string; class?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class={["shrink-0", cls]}
  >
    <path fill-rule="evenodd" clip-rule="evenodd" d={d} />
  </svg>
);

/** ▲ / ▼ for the sort direction. */
const DirArrow = ({ dir }: { dir: "asc" | "desc" }) => (
  <span aria-hidden="true" class="text-[0.7em]">
    {dir === "asc" ? "▲" : "▼"}
  </span>
);

// Drag and drop. The browser only lets a drag's data be read on drop and
// only lets dragover accept it synchronously, so the dragged keys and the
// folder they come from are also kept on <body> for the drag's length.
// These handlers are sync$ (no closures): they read the DOM only.

/** dragstart on a tile: drag the selection, or just this tile. */
const dragStart = sync$((e: DragEvent) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sel-key]");
  const list = el?.closest<HTMLElement>("[data-file-browser]");
  if (!el || !list || !e.dataTransfer) return;
  const keys = el.matches("[aria-selected=true]")
    ? Array.from(
        list.querySelectorAll<HTMLElement>("[aria-selected=true]"),
        (x) => x.dataset.selKey ?? "",
      )
    : [el.dataset.selKey ?? ""];
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("application/x-gallery-items", JSON.stringify(keys));
  document.body.dataset.dragItems = JSON.stringify(keys);
  document.body.dataset.dragFrom = list.dataset.dir ?? "/";
});

/**
 * dragover / drop: accept over a folder ([data-drop]) the items may go
 * into (file-view.ts canDrop, inlined), and mark it.
 */
const dragOver = sync$((e: DragEvent) => {
  const raw = document.body.dataset.dragItems;
  if (!raw) return;
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-drop]");
  for (const x of document.querySelectorAll("[data-drop-over]")) {
    if (x !== t) x.removeAttribute("data-drop-over");
  }
  if (!t) return;
  const dest = t.dataset.drop ?? "";
  const keys = JSON.parse(raw) as string[];
  const folders = keys.filter((k) => k.startsWith("f:")).map((k) => k.slice(2));
  const within = (d: string, f: string) =>
    f === "/" || d === f || d.startsWith(`${f}/`);
  if (
    dest === document.body.dataset.dragFrom ||
    folders.some((f) => within(dest, f))
  ) {
    return;
  }
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  t.setAttribute("data-drop-over", "");
  if (e.type === "drop") document.body.dataset.dropDest = dest;
});

/** The drag is over (dropped or not): forget it. */
const dragDone = sync$(() => {
  for (const x of document.querySelectorAll("[data-drop-over]")) {
    x.removeAttribute("data-drop-over");
  }
  delete document.body.dataset.dragItems;
  delete document.body.dataset.dragFrom;
});

/** Keys the listbox handles itself: no page scroll, no native menu. */
const listKeys = sync$((e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  if (t.getAttribute("role") !== "option" || e.altKey || e.metaKey) return;
  if (
    [
      " ",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ].includes(e.key) ||
    e.key === "ContextMenu" ||
    (e.key === "F10" && e.shiftKey)
  ) {
    e.preventDefault();
  }
});

/**
 * A tile drags only under a mouse: decided per gesture, before the browser
 * could start a drag (touch browsers drag on a long press, which here
 * selects instead).
 */
const dragOnlyWithMouse = sync$((e: PointerEvent) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sel-key]");
  if (el && el.closest("[data-selectable]")) {
    el.draggable = e.pointerType === "mouse";
  }
});

/** No native context menu (or callout) on a tile. */
const noNativeMenu = sync$((e: MouseEvent) => {
  if ((e.target as HTMLElement).closest("[data-sel-key]")) e.preventDefault();
});

export const FileBrowser = component$<Props>(
  ({
    tree,
    dir,
    folder,
    files,
    imageBase,
    platform,
    visibility,
    q,
    date,
    siteDefaults,
    cameras,
    progress,
    onSelection$,
  }) => {
    const href = (path: string) =>
      mediaListHref({
        view: "files",
        dir: path,
        platform,
        visibility,
        q,
        date,
      });

    // The viewer's order and layout.
    const prefs = useSignal<ViewPrefs>(DEFAULT_PREFS);
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      () => {
        let stored = DEFAULT_PREFS;
        try {
          stored = parsePrefs(localStorage.getItem(PREFS_KEY));
        } catch {
          // Storage blocked: the default order.
        }
        // Only when it differs: a re-render here would come while the
        // page may already be in use (a click on the tree, say).
        if (JSON.stringify(stored) !== JSON.stringify(prefs.value)) {
          prefs.value = stored;
        }
      },
      { strategy: "document-ready" },
    );
    const setPrefs = $((p: Partial<ViewPrefs>) => {
      prefs.value = { ...prefs.value, ...p };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value));
      } catch {
        // Not remembered; still applied.
      }
    });
    const sortBy = $((key: SortKey) =>
      setPrefs(
        prefs.value.sort === key
          ? { dir: prefs.value.dir === "asc" ? "desc" : "asc" }
          : { sort: key, dir: "asc" },
      ),
    );
    const listLayout = prefs.value.layout === "list";

    const shownFolders = sortFolders(folder?.children ?? [], prefs.value);
    const shownFiles = sortPhotos(files, prefs.value);
    // Selection and keyboard order: folders, then photos, as shown.
    const order: SelKey[] = [
      ...shownFolders.map((c) => folderKey(c.path)),
      ...shownFiles.map((f) => photoKey(f.id)),
    ];
    const hrefOf: Record<string, string> = {};
    for (const c of shownFolders) hrefOf[folderKey(c.path)] = href(c.path);
    for (const f of shownFiles) {
      hrefOf[photoKey(f.id)] = mediaEditHref(f.id, href(dir));
    }

    const sel = useSignal<Selection>(EMPTY_SELECTION);
    const busy = useSignal(false);
    /** The tile with the tab stop (roving tabindex). */
    const focusKey = useSignal<SelKey | null>(null);
    const menu = useSignal<{
      x: number;
      y: number;
      key: SelKey;
      n: number;
    } | null>(null);
    /** Openings so far: each menu is a fresh instance (key). */
    const menuOpens = useSignal(0);
    const renaming = useSignal<{ key: SelKey; name: string } | null>(null);
    const renameDialog = useSignal<HTMLDialogElement>();
    const command = useSignal<BarCommand | null>(null);
    /** A pending long press, and whether one just selected (eat its click). */
    const press = useSignal<{ timer: number; x: number; y: number } | null>(
      null,
    );
    const pressed = useSignal(false);

    /** The folder and filter the selection was made in. */
    const selView = useSignal("");
    useTask$(({ track }) => {
      // Another folder or filter: keep what it still shows. A reload of
      // the same one keeps every key (it may briefly lack an item); what
      // counts is `shownSel` below.
      // The props are getters on the page's data: when the page leaves the
      // Files view they throw for a moment before this component goes.
      const shown = track(() => {
        try {
          return {
            folders: folder?.children ?? [],
            files,
            view: [dir, platform, visibility, q].join("\n"),
          };
        } catch {
          return null;
        }
      });
      if (!shown) return;
      sel.value = reconcileSelection(
        [
          ...shown.folders.map((c) => folderKey(c.path)),
          ...shown.files.map((f) => photoKey(f.id)),
        ],
        sel.value,
        shown.view === selView.value,
      );
      selView.value = shown.view;
    });
    const selectable = onSelection$ !== undefined;
    /**
     * What is selected and shown: the count, the bar and every action use
     * this, so an item that left the view is never acted on unseen.
     */
    const shownSel = keepShown(order, sel.value);
    // Plain values for the JSX (an expression on a local object there
    // could be kept as a derived signal of the first render).
    const selCount = shownSel.keys.length;
    const firstSelected = shownSel.keys[0];
    const selected = new Set(shownSel.keys);
    const picked = splitSelection(shownSel.keys);
    const pickedFolders = picked.folders;
    const pickedPhotos = files.filter((f) => selected.has(photoKey(f.id)));
    const bytes =
      pickedPhotos.reduce((n, f) => n + (f.size ?? 0), 0) +
      shownFolders
        .filter((c) => selected.has(folderKey(c.path)))
        .reduce((n, c) => n + folderTotals(c).bytes, 0);
    const tabKey =
      focusKey.value && order.includes(focusKey.value)
        ? focusKey.value
        : order[0];

    const nav = useNavigate();
    const open = $((key: SelKey) => {
      const to = hrefOf[key];
      if (to) void nav(to);
    });
    const focusItem = $((key: SelKey) => {
      focusKey.value = key;
      document.getElementById(optionId(key))?.focus();
    });

    /**
     * Runs an action on the selection (or on `keys`, when the action is
     * about one known item); true when it went through.
     */
    const run = $(
      async (a: SelectionAction, keys?: SelKey[]): Promise<boolean> => {
        if (a.kind === "clear") {
          sel.value = EMPTY_SELECTION;
          return true;
        }
        // One at a time (a held Delete must not trash twice).
        if (!onSelection$ || busy.value) return false;
        busy.value = true;
        try {
          // Where the focus was, for when its item goes away.
          const at = focusKey.value ? order.indexOf(focusKey.value) : -1;
          const ok = await onSelection$(
            a,
            splitSelection(keys ?? keepShown(order, sel.value).keys),
          );
          if (ok) sel.value = EMPTY_SELECTION;
          if (ok && at >= 0) {
            // Once the folder is shown again: keyboard users stay in the
            // list (the item at the same place, or the last one).
            await new Promise((r) => setTimeout(r, 50));
            if (document.activeElement === document.body) {
              const items = document.querySelectorAll<HTMLElement>(
                "[data-file-browser] [role=option]",
              );
              const el = items[Math.min(at, items.length - 1)];
              if (el) {
                focusKey.value = el.dataset.selKey as SelKey;
                el.focus();
              }
            }
          }
          return ok;
        } finally {
          busy.value = false;
        }
      },
    );
    /** Select just `key` unless it is already part of the selection. */
    const selectFor = $((key: SelKey) => {
      if (!sel.value.keys.includes(key)) {
        sel.value = { keys: [key], anchor: key };
      }
    });
    const startRename = $((key: SelKey) => {
      sel.value = { keys: [key], anchor: key };
      const name = key.startsWith("p:")
        ? nameOf(files.find((f) => photoKey(f.id) === key)?.path ?? "")
        : nameOf(key.slice(2));
      renaming.value = { key, name };
      const input = renameDialog.value?.querySelector("input");
      if (input) input.value = name;
      renameDialog.value?.showModal();
      // The name without its extension, ready to type over.
      if (input) {
        const dot = name.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : name.length);
      }
    });
    const openMenu = $(async (key: SelKey, x: number, y: number) => {
      await selectFor(key);
      focusKey.value = key;
      // A new `n` per opening: a fresh menu (position, focus) each time.
      menuOpens.value++;
      menu.value = { x, y, key, n: menuOpens.value };
    });

    // Ctrl/Cmd+A selects every tile, Esc clears, Delete trashes (the
    // focused tile when nothing is selected); not while typing in a field
    // or with a dialog or the menu open.
    useOnDocument(
      "keydown",
      $((e: KeyboardEvent) => {
        if (!selectable) return;
        const t = e.target as HTMLElement | null;
        if (
          t?.closest(
            "input, textarea, select, [contenteditable], dialog, [role=menu]",
          )
        ) {
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          sel.value = selectAll(
            Array.from(
              document.querySelectorAll<HTMLElement>("[data-sel-key]"),
              (el) => el.dataset.selKey as SelKey,
            ),
          );
          // The browser also selected the page's text (no sync handler
          // on document to prevent it): take that back.
          window.getSelection()?.removeAllRanges();
        } else if (e.key === "Escape" && sel.value.keys.length > 0) {
          sel.value = EMPTY_SELECTION;
        } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) {
          const focused = t?.closest<HTMLElement>("[data-sel-key]")?.dataset
            .selKey as SelKey | undefined;
          // What is selected among the shown tiles (not keys kept for an
          // item a reload lacks), read from the tiles themselves: this
          // listener may hold an older render's list.
          const shown = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-file-browser] [aria-selected=true]",
            ),
            (el) => el.dataset.selKey as SelKey,
          );
          if (shown.length === 0 && focused) {
            sel.value = { keys: [focused], anchor: focused };
            void run({ kind: "trash" }, [focused]);
          } else if (shown.length > 0) void run({ kind: "trash" }, shown);
        }
      }),
    );

    const listClick = $((e: MouseEvent) => {
      const el = itemOf(e.target);
      if (!el) return;
      if (pressed.value) {
        // The click that ends a long press.
        pressed.value = false;
        return;
      }
      const key = el.dataset.selKey as SelKey;
      focusKey.value = key;
      const modified = e.shiftKey || e.ctrlKey || e.metaKey;
      const onTick = (e.target as HTMLElement).closest("[data-tick]");
      if (
        selectable &&
        (onTick || modified || keepShown(order, sel.value).keys.length > 0)
      ) {
        sel.value = clickItem(order, sel.value, key, {
          range: e.shiftKey,
          toggle: true,
        });
      } else {
        void open(key);
      }
    });
    const listKey = $(async (e: KeyboardEvent) => {
      const el = itemOf(e.target);
      if (!el || el.getAttribute("role") !== "option") return;
      const key = el.dataset.selKey as SelKey;
      const list = el.closest<HTMLElement>("[data-file-browser]");
      const columns =
        prefs.value.layout === "list" || !list
          ? 1
          : getComputedStyle(list).gridTemplateColumns.split(" ").length;
      const next = moveFocus(order.indexOf(key), e.key, order.length, columns);
      if (next !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const to = order[next];
        await focusItem(to);
        if (e.shiftKey && selectable) {
          const base = sel.value.anchor
            ? sel.value
            : { keys: sel.value.keys, anchor: key };
          sel.value = clickItem(order, base, to, {
            range: true,
            toggle: false,
          });
        }
        return;
      }
      if (e.key === " " && selectable) {
        sel.value = clickItem(order, sel.value, key, {
          range: e.shiftKey,
          toggle: true,
        });
      } else if (e.key === "Enter") {
        await open(key);
      } else if (e.key === "F2" && selectable) {
        await startRename(key);
      } else if (
        selectable &&
        (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))
      ) {
        const r = el.getBoundingClientRect();
        await openMenu(key, r.left + 16, r.top + 16);
      }
    });
    const listMenu = $(async (e: MouseEvent) => {
      const el = itemOf(e.target);
      // Touch: a long press selects instead (below). Already open: the
      // menu key / Shift+F10 opened it (some browsers then also fire
      // contextmenu).
      if (!el || !selectable || press.value || pressed.value || menu.value) {
        return;
      }
      await openMenu(el.dataset.selKey as SelKey, e.clientX, e.clientY);
    });
    const pointerDown = $((e: PointerEvent) => {
      // (Reset for any pointer: a long press without a click after it
      // must not eat the next mouse click.)
      pressed.value = false;
      if (e.pointerType === "mouse" || !selectable) return;
      const el = itemOf(e.target);
      if (!el) return;
      const key = el.dataset.selKey as SelKey;
      press.value = {
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          press.value = null;
          pressed.value = true;
          if (!sel.value.keys.includes(key)) {
            sel.value = clickItem(order, sel.value, key, {
              range: false,
              toggle: true,
            });
          }
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS),
      };
    });
    const pointerEnd = $((e: PointerEvent) => {
      const p = press.value;
      if (!p) return;
      if (
        e.type === "pointermove" &&
        Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10
      ) {
        return;
      }
      clearTimeout(p.timer);
      press.value = null;
    });
    const drop = $(async () => {
      const dest = document.body.dataset.dropDest;
      delete document.body.dataset.dropDest;
      if (dest === undefined) return;
      await run({ kind: "move", dest, name: "" });
    });
    const pickDragged = $((e: DragEvent) => {
      const el = itemOf(e.target);
      if (el) return selectFor(el.dataset.selKey as SelKey);
    });

    const menuItems = (key: SelKey): MenuItem[] => {
      const single = selCount <= 1;
      const photos = pickedPhotos.length > 0 || key.startsWith("p:");
      return [
        {
          kind: "item",
          id: "open",
          label: "開く",
          hint: "Enter",
          disabled: !single,
        },
        {
          kind: "item",
          id: "rename",
          label: "名前を変更",
          hint: "F2",
          disabled: !single,
        },
        { kind: "item", id: "move", label: "移動…" },
        { kind: "separator", id: "s1" },
        ...[...VISIBILITIES].reverse().map((v): MenuItem => ({
          kind: "item",
          id: `visibility:${v}`,
          label: VISIBILITY_LABELS_JA[v],
          visibility: v,
          disabled: !photos,
        })),
        { kind: "item", id: "camera", label: "カメラ…", disabled: !photos },
        {
          kind: "item",
          id: "platform",
          label: "プラットフォーム…",
          disabled: !photos,
        },
        {
          kind: "item",
          id: "info",
          label: "タグと撮影データ…",
          disabled: !photos,
        },
        {
          kind: "item",
          id: "metadata",
          label: "公開する情報…",
          disabled: !photos,
        },
        { kind: "separator", id: "s2" },
        {
          kind: "item",
          id: "trash",
          label: "ゴミ箱へ",
          hint: "Delete",
          danger: true,
        },
      ];
    };
    const pickMenu = $(async (id: string, key: SelKey) => {
      if (id === "open") await open(key);
      else if (id === "rename") await startRename(key);
      else if (id === "trash") await run({ kind: "trash" });
      else if (
        id === "move" ||
        id === "metadata" ||
        id === "camera" ||
        id === "platform" ||
        id === "info"
      ) {
        command.value = { kind: id };
      } else if (id.startsWith("visibility:")) {
        command.value = {
          kind: "visibility",
          visibility: id.slice("visibility:".length) as Visibility,
        };
      }
    });
    const submitRename = $(async (form: HTMLFormElement) => {
      const name = String(new FormData(form).get("name") ?? "").trim();
      const r = renaming.value;
      if (!r || !name) return;
      // The item the dialog was opened for, not whatever is selected now:
      // the selection follows the shown items and can change meanwhile
      // (a reload that briefly lacks it, a click elsewhere).
      if (await run({ kind: "rename", name }, [r.key])) {
        renameDialog.value?.close();
      }
    });

    // Nested link list: the root's children are always shown, and a folder's
    // children once the selection is in it (like a file manager's sidebar).
    // Each folder there is also a drop target.
    const renderNode = (node: FolderNode): JSXOutput => {
      const here = node.path === dir;
      const opened = node.path === "/" || isWithin(dir, node.path);
      return (
        <li key={node.path}>
          <Link
            prefetch="js"
            // Keyed by href: Qwik City's Link keeps the href it was first
            // rendered with, and a filter applies without leaving /media.
            key={href(node.path)}
            href={href(node.path)}
            data-drop={node.path}
            // "page" is the view tab; this marks where we are in the tree.
            aria-current={here ? "location" : undefined}
            title={node.path}
            class={[
              "flex items-center gap-2 rounded-md px-2 py-2.5 text-sm sm:py-1.5",
              "data-drop-over:bg-sky-100 data-drop-over:ring-2 data-drop-over:ring-sky-500 dark:data-drop-over:bg-sky-950",
              here
                ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-100"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
            ]}
          >
            <span
              class={here ? "text-sky-600 dark:text-sky-400" : "text-zinc-400"}
            >
              <FolderIcon />
            </span>
            <span class="truncate">{node.name || ROOT_LABEL}</span>
            <Count n={node.count} />
            <span
              class={["w-16 shrink-0 text-right text-xs tabular-nums", muted]}
            >
              {formatDecimalBytes(folderTotals(node).bytes)}
            </span>
          </Link>
          {opened && node.children.length > 0 && (
            <ul class="ml-3 border-l border-zinc-200 pl-1 dark:border-zinc-800">
              {node.children.map(renderNode)}
            </ul>
          )}
        </li>
      );
    };
    // Rendered twice (sidebar / phone disclosure): a fresh node each time.
    const treeList = () => <ul class="space-y-0.5">{renderNode(tree)}</ul>;
    const crumbs = ancestors(dir);
    const menuKey = menu.value?.key ?? tabKey;

    /** Attributes every item (tile or row) of the listbox has. */
    const itemProps = (key: SelKey, name: string) => ({
      id: optionId(key),
      role: "option",
      "aria-selected": selectable ? selected.has(key) : undefined,
      "aria-label": name,
      tabIndex: key === tabKey ? 0 : -1,
      // draggable: set per gesture (dragOnlyWithMouse).
      "data-sel-key": key,
      "data-href": hrefOf[key],
    });
    const itemClass = [
      "group relative cursor-pointer outline-none select-none [-webkit-touch-callout:none]",
      "focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
    ];

    const sortControls = (
      <div class="flex items-center gap-1">
        <label for="files-sort" class="sr-only">
          並べ替え
        </label>
        <select
          id="files-sort"
          data-testid="files-sort"
          onChange$={(_, el) =>
            setPrefs({ sort: el.value as SortKey, dir: "asc" })
          }
          class={[field, "w-auto py-0 sm:h-9"]}
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k} selected={prefs.value.sort === k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="files-sort-dir"
          aria-label={prefs.value.dir === "asc" ? "昇順" : "降順"}
          title={prefs.value.dir === "asc" ? "昇順" : "降順"}
          onClick$={() =>
            setPrefs({ dir: prefs.value.dir === "asc" ? "desc" : "asc" })
          }
          class={[buttonSecondary, "px-3 sm:h-9"]}
        >
          <DirArrow dir={prefs.value.dir} />
        </button>
        <div
          role="group"
          aria-label="表示"
          class="flex rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {(["grid", "list"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={prefs.value.layout === l}
              aria-label={l === "grid" ? "タイル" : "リスト"}
              title={l === "grid" ? "タイル" : "リスト"}
              onClick$={() => setPrefs({ layout: l })}
              class={[
                "inline-flex size-11 items-center justify-center rounded-md sm:size-8",
                prefs.value.layout === l
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ]}
            >
              <Icon d={l === "grid" ? GRID_ICON : LIST_ICON} />
            </button>
          ))}
        </div>
      </div>
    );

    /** A list column header that sorts by it (a second click flips). */
    const header = (key: SortKey, text: string, cls?: string) => (
      <button
        type="button"
        onClick$={() => sortBy(key)}
        aria-label={`${text}で並べ替え`}
        class={[
          "inline-flex items-center gap-1 text-left font-medium hover:text-zinc-900 max-sm:min-h-11 dark:hover:text-zinc-100",
          prefs.value.sort === key && "text-zinc-900 dark:text-zinc-100",
          cls,
        ]}
      >
        {text}
        {prefs.value.sort === key && <DirArrow dir={prefs.value.dir} />}
      </button>
    );
    const listCols =
      "grid grid-cols-[auto_2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[auto_2.5rem_minmax(0,1fr)_9.5rem_5rem_6.5rem_4.5rem]";

    return (
      <div
        class="grid gap-4 sm:grid-cols-[16rem_1fr] sm:items-start"
        onDragOver$={dragOver}
        onDrop$={[dragOver, drop]}
        onDragEnd$={dragDone}
      >
        {/* sm and up: always-visible sidebar. */}
        <nav
          aria-label="Folders"
          class={[card, "hidden p-2 sm:sticky sm:top-4 sm:block"]}
        >
          {treeList()}
        </nav>
        {/* Phones: the same tree behind a disclosure, so the grid comes first. */}
        {/* Keyed by folder so it is closed again after choosing one. */}
        <details key={dir} class={[card, "group sm:hidden"]}>
          <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <FolderIcon />
            Folders
            <span class={["truncate font-normal", muted]}>{dir}</span>
            <span
              aria-hidden="true"
              class={[
                "ml-auto transition-transform group-open:rotate-90",
                muted,
              ]}
            >
              ›
            </span>
          </summary>
          <nav
            aria-label="Folders"
            class="border-t border-zinc-200 p-2 dark:border-zinc-800"
          >
            {treeList()}
          </nav>
        </details>

        <section aria-label="Folder contents" class="min-w-0 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <nav aria-label="Folder path" class="text-sm">
              <ol class="flex flex-wrap items-center gap-1">
                {crumbs.map((c, i) => (
                  <li key={c.path} class="flex items-center gap-1">
                    {i > 0 && (
                      <span aria-hidden="true" class={muted}>
                        /
                      </span>
                    )}
                    {i === crumbs.length - 1 ? (
                      <span aria-current="location" class="font-semibold">
                        {c.name || ROOT_LABEL}
                      </span>
                    ) : (
                      <Link
                        prefetch="js"
                        key={href(c.path)}
                        href={href(c.path)}
                        data-drop={c.path}
                        class="inline-flex min-h-11 items-center rounded px-1 font-medium text-sky-700 underline-offset-4 hover:underline data-drop-over:bg-sky-100 data-drop-over:ring-2 data-drop-over:ring-sky-500 sm:min-h-0 sm:px-0 dark:text-sky-400 dark:data-drop-over:bg-sky-950"
                      >
                        {c.name || ROOT_LABEL}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            {/* Folder actions (new folder, upload) from the page. */}
            <Slot name="toolbar" />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <nav
              aria-label="公開範囲で絞り込む"
              class="flex max-w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white p-0.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              {VISIBILITY_TABS.map((t) => {
                const target = mediaListHref({
                  view: "files",
                  dir,
                  platform,
                  visibility: t.value,
                  q,
                  date,
                });
                const current = visibility === t.value;
                return (
                  <Link
                    prefetch="js"
                    key={target}
                    href={target}
                    aria-current={current ? "true" : undefined}
                    class={[
                      "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 whitespace-nowrap sm:min-h-0 sm:py-1",
                      current
                        ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    ]}
                  >
                    {t.value && (
                      <VisibilityIcon visibility={t.value} class="size-3.5" />
                    )}
                    {t.label}
                  </Link>
                );
              })}
            </nav>
            {sortControls}
          </div>
          {folder && (
            <p
              data-testid="folder-total"
              class={["-mt-2 text-xs tabular-nums", muted]}
            >
              このフォルダ {folderTotals(folder).count} 件 (
              {folderTotals(folder).publicCount} 件公開) ·{" "}
              {formatDecimalBytes(folderTotals(folder).bytes)}
            </p>
          )}
          {/* Upload progress and leftovers, above the folder's contents. */}
          <Slot name="panel" />

          {!folder ? (
            <StatePanel
              tone="empty"
              level={2}
              title="No such folder"
              action={{ href: href("/"), label: ROOT_LABEL }}
            >
              <p>
                No {platform || q ? "matching " : ""}media lives under{" "}
                <code>{dir}</code>.
              </p>
            </StatePanel>
          ) : shownFolders.length === 0 && shownFiles.length === 0 ? (
            <StatePanel tone="empty" level={2} title="This folder is empty">
              <p>
                <code>{dir}</code> has no photos or folders yet.
              </p>
            </StatePanel>
          ) : (
            <div class={listLayout ? [card, "overflow-hidden"] : undefined}>
              {listLayout && (
                // Column headers; the sortable ones sort on a click.
                <div
                  class={[
                    listCols,
                    "border-b border-zinc-200 px-2 py-2 text-xs dark:border-zinc-800",
                    muted,
                  ]}
                >
                  <span class="w-11 sm:w-8" />
                  <span />
                  {header("name", "名前")}
                  <span class="flex gap-3 sm:contents">
                    {header("taken", "撮影日", "max-sm:hidden")}
                    {header("size", "サイズ", "justify-self-end")}
                    <span class="max-sm:hidden">公開範囲</span>
                    <span class="max-sm:hidden">Platform</span>
                  </span>
                </div>
              )}
              <div
                role="listbox"
                aria-label="フォルダの中身"
                aria-multiselectable={selectable ? "true" : undefined}
                aria-orientation={listLayout ? "vertical" : undefined}
                data-file-browser
                data-dir={dir}
                data-layout={prefs.value.layout}
                data-selectable={selectable ? "" : undefined}
                data-selecting={selCount > 0 ? "" : undefined}
                onClick$={listClick}
                onKeyDown$={[listKeys, listKey]}
                onContextMenu$={[noNativeMenu, listMenu]}
                onPointerDown$={[dragOnlyWithMouse, pointerDown]}
                onPointerMove$={pointerEnd}
                onPointerUp$={pointerEnd}
                onPointerCancel$={pointerEnd}
                onDragStart$={[dragStart, pickDragged]}
                onAuxClick$={(e) => {
                  // Middle click: open in a new tab, as a link would.
                  const to = itemOf(e.target)?.dataset.href;
                  if (e.button === 1 && to) window.open(to, "_blank");
                }}
                class={
                  listLayout
                    ? "divide-y divide-zinc-100 dark:divide-zinc-800"
                    : "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
                }
              >
                {shownFolders.map((child) => {
                  const key = folderKey(child.path);
                  return (
                    <div
                      key={child.path}
                      {...itemProps(key, child.name)}
                      title={child.path}
                      data-testid="folder-tile"
                      data-drop={child.path}
                      class={[
                        itemClass,
                        "data-drop-over:ring-2 data-drop-over:ring-sky-500",
                        listLayout
                          ? [
                              listCols,
                              "px-2 py-1 text-sm hover:bg-zinc-50 aria-selected:bg-sky-50 dark:hover:bg-zinc-800/50 dark:aria-selected:bg-sky-950/40",
                            ]
                          : [
                              card,
                              "flex items-center gap-2 px-3 py-3 pr-12 text-sm transition-colors hover:border-sky-300 hover:bg-sky-50/60 aria-selected:ring-2 aria-selected:ring-sky-500 data-drop-over:bg-sky-50 sm:pr-9 dark:hover:border-sky-800 dark:hover:bg-sky-950/30",
                            ],
                      ]}
                    >
                      {selectable && <TickMark list={listLayout} />}
                      <span
                        class={[
                          "text-sky-600 dark:text-sky-400",
                          listLayout && "flex justify-center",
                        ]}
                      >
                        <FolderIcon class={listLayout ? "size-6" : "size-4"} />
                      </span>
                      <span class="min-w-0">
                        <span class="block truncate font-medium">
                          {child.name}
                        </span>
                        {listLayout ? (
                          <span class="sm:hidden">
                            <FolderStats node={child} />
                          </span>
                        ) : (
                          <FolderStats node={child} />
                        )}
                      </span>
                      {listLayout && (
                        <>
                          <span class={["max-sm:hidden", muted]}>—</span>
                          <span
                            class={["text-right text-xs tabular-nums", muted]}
                          >
                            {formatDecimalBytes(folderTotals(child).bytes)}
                          </span>
                          <span class="max-sm:hidden">
                            <FolderStats node={child} bytes={false} />
                          </span>
                          <span class="max-sm:hidden" />
                        </>
                      )}
                    </div>
                  );
                })}
                {shownFiles.map((f) => {
                  const name = nameOf(f.path);
                  const key = photoKey(f.id);
                  return (
                    <div
                      key={f.id}
                      {...itemProps(key, name)}
                      title={f.path}
                      data-testid="file-tile"
                      data-media-id={f.id}
                      class={[
                        itemClass,
                        listLayout
                          ? [
                              listCols,
                              "px-2 py-1 text-sm hover:bg-zinc-50 aria-selected:bg-sky-50 dark:hover:bg-zinc-800/50 dark:aria-selected:bg-sky-950/40",
                            ]
                          : [
                              card,
                              "block overflow-hidden transition-colors hover:border-sky-300 aria-selected:ring-2 aria-selected:ring-sky-500 dark:hover:border-sky-800",
                            ],
                      ]}
                    >
                      {selectable && <TickMark list={listLayout} />}
                      {listLayout ? (
                        <>
                          <Thumb
                            file={f.file}
                            platform={f.platform}
                            imageBase={imageBase}
                            variant="list"
                            class="h-8 w-10 rounded object-cover"
                          />
                          <span class="min-w-0">
                            <span class="block truncate font-medium break-all">
                              {name}
                            </span>
                            <span
                              class={[
                                "flex items-center gap-2 text-xs sm:hidden",
                                muted,
                              ]}
                            >
                              <VisibilityBadge
                                visibility={f.visibility}
                                compact
                              />
                              <span class="tabular-nums">
                                {formatJst(f.timestamp) ?? "—"}
                              </span>
                            </span>
                          </span>
                          <span
                            class={[
                              "text-xs tabular-nums max-sm:hidden",
                              muted,
                            ]}
                          >
                            {formatJst(f.timestamp) ?? "—"}
                          </span>
                          <span
                            class={["text-right text-xs tabular-nums", muted]}
                          >
                            {f.size === null ? "—" : formatDecimalBytes(f.size)}
                          </span>
                          <span class="max-sm:hidden">
                            <VisibilityBadge visibility={f.visibility} />
                          </span>
                          <span class="max-sm:hidden">
                            <span class={platformBadge(f.platform)}>
                              {f.platform}
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span class="relative block">
                            <Thumb
                              file={f.file}
                              platform={f.platform}
                              imageBase={imageBase}
                              variant="list"
                              class="pointer-events-none w-full"
                            />
                            <VisibilityBadge
                              visibility={f.visibility}
                              class="absolute top-1.5 left-1.5 shadow-sm"
                            />
                          </span>
                          {/* Two lines, broken anywhere: VRChat names only
                              differ near the end. */}
                          <span class="line-clamp-2 px-2 pt-1.5 text-xs font-medium break-all">
                            {name}
                          </span>
                          <span
                            class={[
                              "block px-2 pb-1.5 text-xs tabular-nums",
                              muted,
                            ]}
                          >
                            {f.size === null ? "—" : formatDecimalBytes(f.size)}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {selectable && selCount > 0 && (
            <SelectionBar
              count={selCount}
              photos={pickedPhotos}
              bytes={bytes}
              folders={pickedFolders}
              dir={dir}
              tree={tree}
              imageBase={imageBase}
              siteDefaults={siteDefaults}
              cameras={cameras}
              progress={progress ?? null}
              busy={busy}
              command={command}
              onRename$={() => startRename(firstSelected)}
              onAction$={run}
            />
          )}
        </section>

        {menu.value && (
          <ContextMenu
            key={menu.value.n}
            x={menu.value.x}
            y={menu.value.y}
            label={`${selCount} 件の操作`}
            items={menuItems(menu.value.key)}
            onClose$={() => (menu.value = null)}
            // The key as rendered: the menu closes before the pick runs.
            onPick$={(id) => pickMenu(id, menuKey)}
          />
        )}

        <dialog
          ref={renameDialog}
          aria-labelledby="rename-item-title"
          onClose$={() => (renaming.value = null)}
          class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <form
            preventdefault:submit
            onSubmit$={(_, form) => submitRename(form)}
            class="space-y-4 p-4"
          >
            <h2 id="rename-item-title" class="text-base font-semibold">
              名前を変更
            </h2>
            <div>
              <label for="rename-item-name" class={label}>
                名前
              </label>
              <input
                id="rename-item-name"
                name="name"
                // Filled in by startRename.
                required
                maxLength={200}
                autoCapitalize="off"
                autoCorrect="off"
                spellcheck={false}
                class={field}
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick$={() => renameDialog.value?.close()}
                class={buttonSecondary}
              >
                やめる
              </button>
              <button type="submit" disabled={busy.value} class={buttonPrimary}>
                変更
              </button>
            </div>
          </form>
        </dialog>
      </div>
    );
  },
);
