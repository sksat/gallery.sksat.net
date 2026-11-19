import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { formatCount } from "~/lib/cf-graphql";
import type { PageKind, RankedPage } from "~/lib/page-ranking";
import { percentOf } from "~/lib/storage";
import { Thumb } from "./thumb";
import { muted } from "./ui";
import { VisibilityBadge } from "./visibility-badge";

// The dashboard's most viewed pages, one list: a photo opens its edit page
// (with a small link to its public page beside it); any other page opens
// on the public site in a new tab. Old numeric /photo/<N> URLs are one
// quiet row at the end, not a link.

/** Outline icons (24×24, stroked) for the pages that are not photos. */
const ICON: Record<PageKind["kind"] | "external" | "gone", string> = {
  top: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z",
  cameras:
    "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  camera:
    "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  calendar:
    "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm-2 5h18M8 3v4m8-4v4",
  map: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  other: "M6 3h8l4 4v14H6Zm8 0v4h4",
  photo: "M6 3h8l4 4v14H6Zm8 0v4h4",
  "old-photo":
    "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1M4 4l16 16",
  gone: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1M4 4l16 16",
  external:
    "M14 4h6v6m0-6-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};

const Icon = ({ d, class: cls }: { d: string; class?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class={["shrink-0", cls]}
  >
    <path d={d} />
  </svg>
);

// The leading box: as wide as a photo's thumbnail, so every row's label
// starts at the same place.
const Tile = ({ d, quiet }: { d: string; quiet?: boolean }) => (
  <span
    class={[
      "grid aspect-video w-16 shrink-0 place-items-center rounded-md",
      quiet
        ? "bg-zinc-50 text-zinc-400 dark:bg-zinc-800/50 dark:text-zinc-500"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    ]}
  >
    <Icon d={d} class="size-5" />
  </span>
);

const Bar = ({
  value,
  max,
  quiet,
}: {
  value: number;
  max: number;
  quiet?: boolean;
}) => (
  <span
    aria-hidden="true"
    class="mt-1 block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
  >
    <span
      class={[
        "block h-full rounded-full",
        quiet ? "bg-zinc-300 dark:bg-zinc-600" : "bg-sky-500",
      ]}
      style={{ width: `${percentOf(value, max)}%` }}
    />
  </span>
);

const Count = ({ value }: { value: number }) => (
  <span class={["w-12 shrink-0 text-right text-sm tabular-nums", muted]}>
    {formatCount(value)}
  </span>
);

/** "/VRChat/2026-11/" and "a.png" of "/VRChat/2026-11/a.png". */
const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const rowLink =
  "flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50";

// The trailing column: the public page in a new tab, or room for it.
const ExternalMark = () => (
  <span class={["grid size-11 shrink-0 place-items-center sm:size-8", muted]}>
    <Icon d={ICON.external} class="size-4" />
  </span>
);

export const PageRanking = component$<{
  pages: RankedPage[];
  imageBase: string | null;
}>(({ pages, imageBase }) => {
  const max = Math.max(0, ...pages.map((p) => p.pageViews));
  return (
    <div>
      <h3 class="text-sm font-semibold">よく見られたページ</h3>
      {pages.length === 0 ? (
        <p class={["mt-2 text-sm", muted]}>なし</p>
      ) : (
        <ol class="mt-2" data-testid="page-ranking">
          {pages.map((p, i) => (
            <li key={i} class="flex items-center gap-3" data-kind={p.kind}>
              {p.kind === "photo" ? (
                <>
                  <Link
                    prefetch="js"
                    href={`/media/${p.photo.id}/`}
                    class={rowLink}
                  >
                    <Thumb
                      file={p.photo.file}
                      platform={p.photo.platform}
                      imageBase={imageBase}
                      variant="list"
                      class="w-16 rounded-md"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1.5 text-sm">
                        <span class="min-w-0 truncate" title={p.photo.path}>
                          {/* The folder from sm up; on phones the name. */}
                          <span class={["hidden sm:inline", muted]}>
                            {folderOf(p.photo.path)}
                          </span>
                          {nameOf(p.photo.path)}
                        </span>
                        <VisibilityBadge
                          visibility={p.photo.visibility}
                          compact
                          class="shrink-0"
                        />
                      </span>
                      <Bar value={p.pageViews} max={max} />
                    </span>
                    <Count value={p.pageViews} />
                  </Link>
                  {p.photo.visibility === "private" ? (
                    // No working public page: keep the column.
                    <span class="size-11 shrink-0 sm:size-8" />
                  ) : (
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="公開サイトで開く（新しいタブ）"
                      title="公開サイトで開く"
                      class="rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <ExternalMark />
                    </a>
                  )}
                </>
              ) : p.kind === "page" ? (
                <a
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  class={rowLink}
                  title={p.href}
                >
                  <Tile d={ICON[p.page]} />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm">
                      {p.label}
                      <span class="sr-only">（新しいタブ）</span>
                    </span>
                    <Bar value={p.pageViews} max={max} />
                  </span>
                  <Count value={p.pageViews} />
                  <ExternalMark />
                </a>
              ) : (
                <div
                  class={[
                    rowLink,
                    "hover:bg-transparent dark:hover:bg-transparent",
                  ]}
                >
                  <Tile d={ICON.gone} quiet />
                  <span class="min-w-0 flex-1">
                    <span class={["block truncate text-sm", muted]}>
                      {p.kind === "old" ? "旧 URL" : p.path}
                    </span>
                    <Bar value={p.pageViews} max={max} quiet />
                  </span>
                  <Count value={p.pageViews} />
                  <span class="size-11 shrink-0 sm:size-8" />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
