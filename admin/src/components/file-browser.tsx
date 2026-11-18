import {
  $,
  component$,
  Slot,
  sync$,
  useOnDocument,
  useSignal,
  useTask$,
  type JSXOutput,
  type QRL,
} from "@builder.io/qwik";
import { Link, useNavigate } from "@builder.io/qwik-city";
import {
  ancestors,
  folderTotals,
  isWithin,
  type FolderNode,
} from "~/lib/folders";
import { mediaEditHref, mediaListHref } from "~/lib/format";
import {
  clickItem,
  EMPTY_SELECTION,
  folderKey,
  keepShown,
  photoKey,
  selectAll,
  splitSelection,
  type Selection,
  type SelKey,
} from "~/lib/selection";
import type { MetadataLevels, MetadataOverrides } from "~/lib/metadata";
import { formatDecimalBytes } from "~/lib/storage";
import type { MediaPlatform, Visibility } from "~/lib/types";
import { SelectionBar, type SelectionAction } from "./selection-bar";
import { StatePanel } from "./state-panel";
import { Thumb } from "./thumb";
import { VisibilityBadge } from "./visibility-badge";
import { VisibilityIcon } from "./visibility-style";
import { card, muted } from "./ui";

// File-manager view of /media: the folder tree built from the file paths on
// the left (a disclosure on phones) and the selected folder's subfolders and
// photos as a tile grid on the right. Everything is a plain link that keeps
// the view, folder and filter in the URL, so reload/back work and the tree
// is navigable with Tab / Enter.

/** A photo tile: `path` places and names it, `file` is its thumbnail. */
export type FileTile = {
  id: number;
  file: string;
  path: string;
  platform: MediaPlatform;
  visibility: Visibility;
  size: number | null;
  /** Its public metadata overrides (for a bulk change). */
  metadata: MetadataOverrides;
};

type Props = {
  tree: FolderNode;
  /** Selected folder (normalised, "/" = root). */
  dir: string;
  /** The selected folder, or null if no (filtered) file lives under dir. */
  folder: FolderNode | null;
  /** Photos directly in `dir`, sorted by name. */
  files: FileTile[];
  imageBase: string | null;
  platform: MediaPlatform | null;
  visibility: Visibility | null;
  q: string;
  /** The site's metadata levels (what 既定 is in a bulk change). */
  siteDefaults: MetadataLevels;
  /**
   * Runs an action on the selection (move / visibility / trash); resolves
   * true when it succeeded, so the selection is cleared. Without it the
   * tiles cannot be selected.
   */
  onSelection$?: QRL<
    (a: SelectionAction, items: SelectedItems) => Promise<boolean>
  >;
};

export type SelectedItems = { photos: number[]; folders: string[] };

const ROOT_LABEL = "All files";

/** A tile's tick box (the label is the tile's name). */
const TickBox = ({
  checked,
  name,
  selKey,
  order,
  onPick,
}: {
  checked: boolean;
  name: string;
  selKey: SelKey;
  order: SelKey[];
  onPick: QRL<(key: SelKey, e: MouseEvent, order: SelKey[]) => void>;
}) => (
  <input
    type="checkbox"
    checked={checked}
    aria-label={`${name} を選ぶ`}
    data-testid="tile-check"
    onClick$={$((e: MouseEvent) => onPick(selKey, e, order))}
    class="absolute top-1 right-1 z-10 size-11 cursor-pointer appearance-none rounded-lg before:absolute before:inset-2.5 before:rounded-md before:border-2 before:border-white before:bg-black/30 before:shadow checked:before:border-sky-600 checked:before:bg-sky-600 focus-visible:outline-2 focus-visible:outline-sky-500 sm:size-8 sm:before:inset-1.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:checked:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [[data-selecting]_&]:opacity-100"
  />
);

const FolderIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class="size-4 shrink-0"
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
const FolderStats = ({ node }: { node: FolderNode }) => (
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
    {" · "}
    {formatDecimalBytes(folderTotals(node).bytes)}
  </span>
);

/** Links for すべて / 公開のみ / 非公開のみ (the visibility filter). */
const VISIBILITY_TABS: { label: string; value: Visibility | null }[] = [
  { label: "すべて", value: null },
  { label: "公開のみ", value: "public" },
  { label: "限定公開のみ", value: "unlisted" },
  { label: "非公開のみ", value: "private" },
];

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
    siteDefaults,
    onSelection$,
  }) => {
    const href = (path: string) =>
      mediaListHref({ view: "files", dir: path, platform, visibility, q });

    // Selection: folders, then photos, in the order shown.
    const sel = useSignal<Selection>(EMPTY_SELECTION);
    const busy = useSignal(false);
    const order: SelKey[] = [
      ...(folder?.children ?? []).map((c) => folderKey(c.path)),
      ...files.map((f) => photoKey(f.id)),
    ];
    useTask$(({ track }) => {
      // Another folder, filter or a reload: keep what is still shown.
      // The props are getters on the page's data: when the page leaves the
      // Files view they throw for a moment before this component goes.
      const shown = track(() => {
        try {
          return { folders: folder?.children ?? [], files };
        } catch {
          return null;
        }
      });
      if (!shown) return;
      const { folders: shownFolders, files: shownFiles } = shown;
      sel.value = keepShown(
        [
          ...shownFolders.map((c) => folderKey(c.path)),
          ...shownFiles.map((f) => photoKey(f.id)),
        ],
        sel.value,
      );
    });
    const selectable = onSelection$ !== undefined;
    const selected = new Set(sel.value.keys);
    const picked = splitSelection(sel.value.keys);
    const pickedPhotos = files.filter((f) => selected.has(photoKey(f.id)));
    const bytes =
      pickedPhotos.reduce((n, f) => n + (f.size ?? 0), 0) +
      (folder?.children ?? [])
        .filter((c) => selected.has(folderKey(c.path)))
        .reduce((n, c) => n + folderTotals(c).bytes, 0);

    const click = $((key: SelKey, e: MouseEvent, keys: SelKey[]) => {
      sel.value = clickItem(keys, sel.value, key, {
        range: e.shiftKey,
        toggle: true,
      });
    });
    const nav = useNavigate();
    /**
     * A click on a tile: select with a modifier or while selecting, else
     * open it in the app (a modified click without selection is the
     * browser's).
     */
    const tileClick = $(
      (key: SelKey, e: MouseEvent, keys: SelKey[], to: string) => {
        const modified = e.shiftKey || e.ctrlKey || e.metaKey;
        if (selectable && (modified || sel.value.keys.length > 0)) {
          sel.value = clickItem(keys, sel.value, key, {
            range: e.shiftKey,
            toggle: true,
          });
        } else if (!modified) {
          void nav(to);
        }
      },
    );
    /** Runs an action on the selection; true when it went through. */
    const run = $(async (a: SelectionAction): Promise<boolean> => {
      if (a.kind === "clear") {
        sel.value = EMPTY_SELECTION;
        return true;
      }
      // One at a time (a held Delete must not trash twice).
      if (!onSelection$ || busy.value) return false;
      busy.value = true;
      try {
        const ok = await onSelection$(a, splitSelection(sel.value.keys));
        if (ok) sel.value = EMPTY_SELECTION;
        return ok;
      } finally {
        busy.value = false;
      }
    });
    // Ctrl/Cmd+A selects every tile, Esc clears, Delete trashes; not
    // while typing in a field or with a dialog open.
    useOnDocument(
      "keydown",
      $((e: KeyboardEvent) => {
        if (!selectable) return;
        const t = e.target as HTMLElement | null;
        // (A tile's tick box keeps the focus after a click: not typing.)
        if (
          t?.closest(
            "input:not([type=checkbox]), textarea, select, [contenteditable], dialog",
          )
        ) {
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          const keys = Array.from(
            document.querySelectorAll<HTMLElement>("[data-sel-key]"),
            (el) => el.dataset.selKey as SelKey,
          );
          sel.value = selectAll(keys);
          // The browser also selected the page's text (no sync handler
          // on document to prevent it): take that back.
          window.getSelection()?.removeAllRanges();
        } else if (e.key === "Escape" && sel.value.keys.length > 0) {
          sel.value = EMPTY_SELECTION;
        } else if (
          (e.key === "Delete" || e.key === "Backspace") &&
          sel.value.keys.length > 0
        ) {
          void run({ kind: "trash" });
        }
      }),
    );

    // Nested link list: the root's children are always shown, and a folder's
    // children once the selection is in it (like a file manager's sidebar).
    const renderNode = (node: FolderNode): JSXOutput => {
      const selected = node.path === dir;
      const open = node.path === "/" || isWithin(dir, node.path);
      return (
        <li key={node.path}>
          <Link
            // Keyed by href: Qwik City's Link keeps the href it was first
            // rendered with, and a filter applies without leaving /media.
            key={href(node.path)}
            href={href(node.path)}
            // "page" is the view tab; this marks where we are in the tree.
            aria-current={selected ? "location" : undefined}
            title={node.path}
            class={[
              "flex items-center gap-2 rounded-md px-2 py-2.5 text-sm sm:py-1.5",
              selected
                ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-100"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
            ]}
          >
            <span
              class={
                selected ? "text-sky-600 dark:text-sky-400" : "text-zinc-400"
              }
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
          {open && node.children.length > 0 && (
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

    return (
      <div class="grid gap-4 sm:grid-cols-[16rem_1fr] sm:items-start">
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
                        key={href(c.path)}
                        href={href(c.path)}
                        class="inline-flex min-h-11 items-center rounded px-1 font-medium text-sky-700 underline-offset-4 hover:underline sm:min-h-0 sm:px-0 dark:text-sky-400"
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
              class="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              {VISIBILITY_TABS.map((t) => {
                const target = mediaListHref({
                  view: "files",
                  dir,
                  platform,
                  visibility: t.value,
                  q,
                });
                const current = visibility === t.value;
                return (
                  <Link
                    key={target}
                    href={target}
                    aria-current={current ? "true" : undefined}
                    class={[
                      "inline-flex min-h-11 items-center gap-1 rounded-md px-3 sm:min-h-0 sm:py-1",
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
            {folder && (
              <p
                data-testid="folder-total"
                class={["text-xs tabular-nums", muted]}
              >
                このフォルダ {folderTotals(folder).count} 件 (
                {folderTotals(folder).publicCount} 件公開) ·{" "}
                {formatDecimalBytes(folderTotals(folder).bytes)}
              </p>
            )}
          </div>
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
          ) : folder.children.length === 0 && files.length === 0 ? (
            <StatePanel tone="empty" level={2} title="This folder is empty">
              <p>
                <code>{dir}</code> has no photos or folders yet.
              </p>
            </StatePanel>
          ) : (
            <ul
              aria-label="フォルダの中身"
              data-file-browser
              data-selectable={selectable ? "" : undefined}
              data-selecting={sel.value.keys.length > 0 ? "" : undefined}
              class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4"
            >
              {folder.children.map((child) => (
                <li
                  key={child.path}
                  data-sel-key={folderKey(child.path)}
                  // (The tick box carries the state for assistive tech.)
                  data-selected={
                    selected.has(folderKey(child.path)) ? "" : undefined
                  }
                  class="group relative rounded-xl data-selected:ring-2 data-selected:ring-sky-500"
                >
                  {selectable && (
                    <TickBox
                      checked={selected.has(folderKey(child.path))}
                      name={child.name}
                      selKey={folderKey(child.path)}
                      order={order}
                      onPick={click}
                    />
                  )}
                  <a
                    key={href(child.path)}
                    href={href(child.path)}
                    data-testid="folder-tile"
                    title={child.path}
                    onClick$={[
                      sync$((e: MouseEvent, el: HTMLElement) => {
                        // Handled below (open or select); without selection a
                        // modified click keeps the browser's own (new tab…).
                        if (
                          !el.closest("[data-selectable]") &&
                          (e.ctrlKey || e.metaKey || e.shiftKey)
                        )
                          return;
                        e.preventDefault();
                      }),
                      $((e: MouseEvent, el: HTMLAnchorElement) =>
                        tileClick(
                          folderKey(child.path),
                          e,
                          order,
                          el.getAttribute("href") ?? "",
                        ),
                      ),
                    ]}
                    class={[
                      card,
                      "flex h-full items-center gap-2 px-3 py-3 pr-12 text-sm transition-colors hover:border-sky-300 hover:bg-sky-50/60 sm:pr-9 dark:hover:border-sky-800 dark:hover:bg-sky-950/30",
                    ]}
                  >
                    <span class="text-sky-600 dark:text-sky-400">
                      <FolderIcon />
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate font-medium">
                        {child.name}
                      </span>
                      <FolderStats node={child} />
                    </span>
                  </a>
                </li>
              ))}
              {files.map((f) => {
                const name = f.path.slice(f.path.lastIndexOf("/") + 1);
                const key = photoKey(f.id);
                return (
                  <li
                    key={f.id}
                    data-sel-key={key}
                    data-selected={selected.has(key) ? "" : undefined}
                    class="group relative rounded-xl data-selected:ring-2 data-selected:ring-sky-500"
                  >
                    {selectable && (
                      <TickBox
                        checked={selected.has(key)}
                        name={name}
                        selKey={key}
                        order={order}
                        onPick={click}
                      />
                    )}
                    <a
                      key={href(dir)}
                      href={mediaEditHref(f.id, href(dir))}
                      data-testid="file-tile"
                      data-media-id={f.id}
                      title={f.path}
                      onClick$={[
                        sync$((e: MouseEvent, el: HTMLElement) => {
                          // Handled below (open or select); without selection a
                          // modified click keeps the browser's own (new tab…).
                          if (
                            !el.closest("[data-selectable]") &&
                            (e.ctrlKey || e.metaKey || e.shiftKey)
                          )
                            return;
                          e.preventDefault();
                        }),
                        $((e: MouseEvent, el: HTMLAnchorElement) =>
                          tileClick(
                            key,
                            e,
                            order,
                            el.getAttribute("href") ?? "",
                          ),
                        ),
                      ]}
                      class={[
                        card,
                        "block overflow-hidden transition-colors hover:border-sky-300 dark:hover:border-sky-800",
                      ]}
                    >
                      <span class="relative block">
                        <Thumb
                          file={f.file}
                          platform={f.platform}
                          imageBase={imageBase}
                          variant="list"
                          class="w-full"
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
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          {selectable && sel.value.keys.length > 0 && (
            <SelectionBar
              count={sel.value.keys.length}
              photos={pickedPhotos}
              bytes={bytes}
              folders={picked.folders}
              dir={dir}
              tree={tree}
              imageBase={imageBase}
              siteDefaults={siteDefaults}
              busy={busy}
              onAction$={run}
            />
          )}
        </section>
      </div>
    );
  },
);
