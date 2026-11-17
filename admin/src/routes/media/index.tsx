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
import { getDB } from "~/lib/env";
import { formatJst, lastPage, mediaListHref, splitPath } from "~/lib/format";
import type { MediaRow, MediaWorld } from "~/lib/types";

const PAGE_SIZE = 100;

type MediaListResult =
  | {
      kind: "ok";
      rows: MediaRow[];
      total: number;
      page: number;
      world: MediaWorld | null;
      q: string;
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
      rows,
      total,
      page,
      world: world ?? null,
      q: q ?? "",
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
  const { rows, total, page, world, q } = data.value;
  const pageCount = lastPage(total, PAGE_SIZE);
  const filtered = Boolean(world || q);
  const pageUrl = (p: number) => mediaListHref({ world, q, page: p });
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + rows.length;

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Media <span class={["font-normal", muted]}>({total})</span>
        </h1>
        <p class={["text-sm", muted]}>
          Click a row to edit its metadata. Times are JST.
        </p>
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
            <Link href="/media/" class={buttonSecondary}>
              Reset
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <StatePanel
            tone="empty"
            level={2}
            title="No media match these filters"
            action={{ href: "/media/", label: "Clear filters" }}
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
                    class="relative align-top transition-colors hover:bg-sky-50/60 has-[a:focus-visible]:bg-sky-50/60 dark:hover:bg-sky-950/30 dark:has-[a:focus-visible]:bg-sky-950/30"
                  >
                    <td class={["px-4 py-3 tabular-nums", muted]}>{row.id}</td>
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
                  class="flex flex-col gap-2 px-4 py-3 active:bg-sky-50 dark:active:bg-sky-950/30"
                >
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
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {total > 0 && (
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
