import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
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
  worldBadge,
} from "~/components/ui";
import { listMedia } from "~/lib/db";
import { listMediaFiles } from "~/lib/db-files";
import { FileBrowser, type FileTile } from "~/components/file-browser";
import { Thumb } from "~/components/thumb";
import { getDB, getImageBase } from "~/lib/env";
import {
  buildFolderTree,
  filesInDir,
  findFolder,
  normalizeDir,
  type FolderNode,
} from "~/lib/folders";
import {
  formatJst,
  lastPage,
  mediaListHref,
  parseView,
  splitPath,
  type MediaView,
} from "~/lib/format";
import type { MediaRow, MediaWorld } from "~/lib/types";

const PAGE_SIZE = 100;
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
};

type MediaListResult =
  | {
      kind: "ok";
      view: MediaView;
      rows: MediaRow[];
      total: number;
      page: number;
      world: MediaWorld | null;
      q: string;
      /** Image Worker base URL, or null for placeholder tiles. */
      imageBase: string | null;
      /** Only for view === "files". */
      files: FilesData | null;
    }
  | { kind: "missing-binding" };

export const useMediaList = routeLoader$<MediaListResult>(
  async ({ platform, query, status, redirect }) => {
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
    const q = query.get("q")?.trim() || undefined;
    const imageBase = getImageBase(platform);

    if (parseView(query.get("view")) === "files") {
      const { rows, truncated } = await listMediaFiles(db, {
        world,
        q,
        limit: FILES_LIMIT,
      });
      const dir = normalizeDir(query.get("dir"));
      const tree = buildFolderTree(rows.map((r) => r.file));
      return {
        kind: "ok",
        view: "files",
        rows: [],
        total: rows.length,
        page: 1,
        world: world ?? null,
        q: q ?? "",
        imageBase,
        files: {
          tree,
          dir,
          folder: findFolder(tree, dir),
          files: filesInDir(rows, dir),
          truncated,
        },
      };
    }

    const pageRaw = Number(query.get("page") ?? "1");
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const offset = (page - 1) * PAGE_SIZE;

    const { rows, total } = await listMedia(db, {
      world,
      q,
      limit: PAGE_SIZE,
      offset,
    });
    // Past the end (stale link, or a filter that shrank the result): send
    // the user to the last page that has rows instead of "Page 2 / 1".
    if (rows.length === 0 && page > 1) {
      throw redirect(
        302,
        mediaListHref({ world, q, page: lastPage(total, PAGE_SIZE) }),
      );
    }
    return {
      kind: "ok",
      view: "list",
      rows,
      total,
      page,
      world: world ?? null,
      q: q ?? "",
      imageBase,
      files: null,
    };
  },
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
  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { view, rows, total, page, world, q, imageBase, files } = data.value;
  const pageCount = lastPage(total, PAGE_SIZE);
  const filtered = Boolean(world || q);
  const dir = files?.dir ?? "/";
  const pageUrl = (p: number) => mediaListHref({ world, q, page: p });
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + rows.length;
  // Switching keeps the filter; the folder is remembered only in files view.
  const viewTabs: { view: MediaView; label: string; href: string }[] = [
    { view: "list", label: "List", href: mediaListHref({ world, q }) },
    {
      view: "files",
      label: "Files",
      href: mediaListHref({ view: "files", dir, world, q }),
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
              ? "Click a photo to edit its metadata."
              : "Click a row to edit its metadata. Times are JST."}
          </p>
          <nav
            aria-label="View"
            class="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {viewTabs.map((t) => (
              <Link
                key={t.view}
                href={t.href}
                aria-current={t.view === view ? "page" : undefined}
                class={[
                  "rounded-md px-3 py-1 font-medium",
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

      <form
        method="get"
        action="/media/"
        role="search"
        class={[
          card,
          "grid gap-3 p-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end",
        ]}
      >
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
          <select id="filter-world" name="world" class={field}>
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
          <label for="filter-q" class={label}>
            File contains
          </label>
          <input
            id="filter-q"
            type="search"
            name="q"
            value={q}
            placeholder="e.g. 2023-12"
            class={field}
          />
        </div>
        <div class="flex gap-2">
          <button type="submit" class={buttonPrimary}>
            Filter
          </button>
          {filtered && (
            <Link href={mediaListHref({ view, dir })} class={buttonSecondary}>
              Reset
            </Link>
          )}
        </div>
      </form>

      {total === 0 ? (
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
              {world ? ` world “${world}”` : ""}
              {world && q ? " and" : ""}
              {q ? ` a file path containing “${q}”` : ""}.
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
          <FileBrowser
            tree={files.tree}
            dir={files.dir}
            folder={files.folder}
            files={files.files}
            imageBase={imageBase}
            world={world}
            q={q}
          />
        </>
      ) : (
        <>
          {/* sm and up: table. Every row is one link target (stretched link). */}
          <div class={[card, "hidden overflow-hidden sm:block"]}>
            <table class="w-full table-fixed text-left text-sm">
              <thead class="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th scope="col" class="w-14 px-4 py-2.5 font-medium">
                    ID
                  </th>
                  <th scope="col" class="w-[8.5rem] px-4 py-2.5 font-medium">
                    <span class="sr-only">Thumbnail</span>
                  </th>
                  <th scope="col" class="px-4 py-2.5 font-medium">
                    File
                  </th>
                  <th scope="col" class="w-24 px-4 py-2.5 font-medium">
                    World
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
                    class="relative align-middle transition-colors hover:bg-sky-50/60 has-[a:focus-visible]:bg-sky-50/60 dark:hover:bg-sky-950/30 dark:has-[a:focus-visible]:bg-sky-950/30"
                  >
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
                        href={`/media/${row.id}/`}
                        title={row.file}
                        class="block min-w-0 rounded after:absolute after:inset-0 after:content-['']"
                      >
                        <FileName file={row.file} />
                      </Link>
                    </td>
                    <td class="px-4 py-3">
                      <span class={worldBadge(row.world)}>{row.world}</span>
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

          {/* Below sm: stacked cards, no horizontal overflow. */}
          <ul
            class={[
              card,
              "divide-y divide-zinc-100 sm:hidden dark:divide-zinc-800",
            ]}
          >
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/media/${row.id}/`}
                  title={row.file}
                  class="flex items-start gap-3 px-4 py-3 active:bg-sky-50 dark:active:bg-sky-950/30"
                >
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
                      <span class="tabular-nums">
                        {formatJst(row.timestamp) ?? "—"}
                      </span>
                      {row.tags.length > 0 && <Tags tags={row.tags} />}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
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
              <Link href={pageUrl(page - 1)} class={buttonSecondary}>
                ← Prev
              </Link>
            )}
            {page < pageCount && (
              <Link href={pageUrl(page + 1)} class={buttonSecondary}>
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
});

export const head: DocumentHead = {
  title: "Media — Admin",
};
