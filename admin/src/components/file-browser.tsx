import { component$, type JSXOutput } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { ancestors, isWithin, type FolderNode } from "~/lib/folders";
import { mediaEditHref, mediaListHref } from "~/lib/format";
import type { MediaWorld, Visibility } from "~/lib/types";
import { StatePanel } from "./state-panel";
import { Thumb } from "./thumb";
import { card, muted } from "./ui";

// File-manager view of /media: the folder tree built from the file paths on
// the left (a disclosure on phones) and the selected folder's subfolders and
// photos as a tile grid on the right. Everything is a plain link that keeps
// the view, folder and filter in the URL, so reload/back work and the tree
// is navigable with Tab / Enter.

export type FileTile = { id: number; file: string; world: MediaWorld };

type Props = {
  tree: FolderNode;
  /** Selected folder (normalised, "/" = root). */
  dir: string;
  /** The selected folder, or null if no (filtered) file lives under dir. */
  folder: FolderNode | null;
  /** Photos directly in `dir`, sorted by name. */
  files: FileTile[];
  imageBase: string | null;
  world: MediaWorld | null;
  visibility: Visibility | null;
  q: string;
};

const ROOT_LABEL = "All files";

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

export const FileBrowser = component$<Props>(
  ({ tree, dir, folder, files, imageBase, world, visibility, q }) => {
    const href = (path: string) =>
      mediaListHref({ view: "files", dir: path, world, visibility, q });

    // Nested link list: the root's children are always shown, and a folder's
    // children once the selection is in it (like a file manager's sidebar).
    const renderNode = (node: FolderNode): JSXOutput => {
      const selected = node.path === dir;
      const open = node.path === "/" || isWithin(dir, node.path);
      return (
        <li key={node.path}>
          <Link
            href={href(node.path)}
            // "page" is the view tab; this marks where we are in the tree.
            aria-current={selected ? "location" : undefined}
            title={node.path}
            class={[
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
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
                      href={href(c.path)}
                      class="rounded font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400"
                    >
                      {c.name || ROOT_LABEL}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          {!folder ? (
            <StatePanel
              tone="empty"
              level={2}
              title="No such folder"
              action={{ href: href("/"), label: ROOT_LABEL }}
            >
              <p>
                No {world || q ? "matching " : ""}media lives under{" "}
                <code>{dir}</code>.
              </p>
            </StatePanel>
          ) : (
            <ul class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {folder.children.map((child) => (
                <li key={child.path}>
                  <Link
                    href={href(child.path)}
                    data-testid="folder-tile"
                    title={child.path}
                    class={[
                      card,
                      "flex h-full items-center gap-2 px-3 py-3 text-sm transition-colors hover:border-sky-300 hover:bg-sky-50/60 dark:hover:border-sky-800 dark:hover:bg-sky-950/30",
                    ]}
                  >
                    <span class="text-sky-600 dark:text-sky-400">
                      <FolderIcon />
                    </span>
                    <span class="truncate font-medium">{child.name}</span>
                    <Count n={child.count} />
                  </Link>
                </li>
              ))}
              {files.map((f) => {
                const name = f.file.slice(f.file.lastIndexOf("/") + 1);
                return (
                  <li key={f.id}>
                    <Link
                      href={mediaEditHref(f.id, href(dir))}
                      data-testid="file-tile"
                      title={f.file}
                      class={[
                        card,
                        "block overflow-hidden transition-colors hover:border-sky-300 dark:hover:border-sky-800",
                      ]}
                    >
                      <Thumb
                        file={f.file}
                        world={f.world}
                        imageBase={imageBase}
                        variant="list"
                        class="w-full"
                      />
                      {/* Two lines, broken anywhere: VRChat names only
                          differ near the end. */}
                      <span class="line-clamp-2 px-2 py-1.5 text-xs font-medium break-all">
                        {name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  },
);
