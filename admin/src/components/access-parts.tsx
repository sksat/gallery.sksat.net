import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { changeDirection, formatChange } from "~/lib/chart";
import { formatCount } from "~/lib/cf-graphql";
import type { RankedPage } from "~/lib/page-ranking";
import { percentOf } from "~/lib/storage";
import {
  ACCESS_RANGE_LABELS,
  changeRatio,
  countryLabel,
  referrerLabel,
  TOP_LIMIT,
  type AccessRange,
  type AccessStats,
} from "~/lib/web-analytics";
import { Thumb } from "./thumb";
import { muted } from "./ui";
import { VisibilityBadge } from "./visibility-badge";

// Pieces shared by the dashboard's access summary, /analytics/ and a
// photo's access card.

/** Web Analytics counts are sampled: one quiet mark says so. */
export const SampledBadge = () => (
  <span
    class="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    title="Cloudflare Web Analytics の標本から推定した数 (5 分ごとに更新)"
  >
    概数
  </span>
);

/** The change against the previous period, with an arrow and a sign. */
export const Change = ({
  cur,
  prev,
  range,
}: {
  cur: number;
  prev: number;
  range: AccessRange;
}) => {
  const period = `前の ${ACCESS_RANGE_LABELS[range]}`;
  const ratio = changeRatio(cur, prev);
  if (ratio === null) {
    return (
      <span class={["text-xs", muted]}>
        {period} {formatCount(prev)}
      </span>
    );
  }
  const dir = changeDirection(ratio);
  return (
    <span class="text-xs" title={`${period} ${formatCount(prev)}`}>
      <span
        class={[
          "font-semibold tabular-nums",
          dir === "up"
            ? "text-emerald-700 dark:text-emerald-400"
            : dir === "down"
              ? "text-rose-700 dark:text-rose-400"
              : muted,
        ]}
      >
        <span aria-hidden="true">
          {dir === "up" ? "▲ " : dir === "down" ? "▼ " : ""}
        </span>
        {formatChange(ratio)}
      </span>
      <span class={muted}> {period}比</span>
    </span>
  );
};

/** A headline number with its change. */
export const StatTile = ({
  label,
  value,
  prev,
  range,
  size = "lg",
}: {
  label: string;
  value: number;
  prev: number;
  range: AccessRange;
  size?: "lg" | "md";
}) => (
  <div class="min-w-0">
    <dt class={["text-xs", muted]}>{label}</dt>
    <dd
      class={[
        "font-semibold tracking-tight",
        size === "lg" ? "text-3xl" : "text-2xl",
      ]}
    >
      {formatCount(value)}
    </dd>
    <dd>
      <Change cur={value} prev={prev} range={range} />
    </dd>
  </div>
);

/** One line per row: name, a thin bar, the count. */
export const BarList = ({
  title,
  rows,
}: {
  /** Its heading; none when the section around it has one. */
  title?: string;
  rows: { label: string; value: number }[];
}) => {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <div>
      {title && <h3 class="mb-2 text-sm font-semibold">{title}</h3>}
      {rows.length === 0 ? (
        <p class={["text-sm", muted]}>なし</p>
      ) : (
        <ol class="space-y-1.5">
          {rows.map((r, i) => (
            <li
              key={i}
              class="grid grid-cols-[minmax(0,8rem)_1fr_3rem] items-center gap-3 text-sm"
            >
              <span class="truncate" title={r.label}>
                {r.label}
              </span>
              <span
                aria-hidden="true"
                class="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              >
                <span
                  class="block h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                  style={{ width: `${percentOf(r.value, max)}%` }}
                />
              </span>
              <span class={["text-right tabular-nums", muted]}>
                {formatCount(r.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/** The first TOP_LIMIT countries (the site's stats read all, for the map). */
export const countryRows = (stats: Pick<AccessStats, "countries">) =>
  stats.countries.slice(0, TOP_LIMIT).map((c) => ({
    label: countryLabel(c.country),
    value: c.pageViews,
  }));

export const referrerRows = (stats: Pick<AccessStats, "referrers">) =>
  stats.referrers.map((r) => ({
    label: referrerLabel(r.host),
    value: r.pageViews,
  }));

/** Segmented control look, for links and buttons alike. */
export const segment = (current: boolean) => [
  "inline-flex h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-medium sm:h-8",
  current
    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white",
];
export const segmentGroup =
  "inline-flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800";

const LINK_OFF =
  "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1M4 4l16 16";

/** "a.png" of "/VRChat/2026-11/a.png". */
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// The most viewed photos as thumbnails, ranked: each opens its edit page.
// A photo that is gone (or could not be looked up) keeps its place.
export const PhotoRanking = component$<{
  photos: RankedPage[];
  imageBase: string | null;
  class?: string;
}>(({ photos, imageBase, class: cls }) =>
  photos.length === 0 ? (
    <p class={["text-sm", muted]}>なし</p>
  ) : (
    <ol class={["grid gap-3", cls]} data-testid="photo-ranking">
      {photos.map((p, i) => (
        <li key={i} class="min-w-0">
          {p.kind === "photo" ? (
            <Link
              prefetch="js"
              href={`/media/${p.photo.id}/`}
              class="group block rounded-lg focus-visible:outline-2 focus-visible:outline-sky-500"
              title={p.photo.path}
            >
              <span class="relative block">
                <Thumb
                  file={p.photo.file}
                  platform={p.photo.platform}
                  imageBase={imageBase}
                  variant="list"
                  class="w-full rounded-lg ring-1 ring-black/5 transition group-hover:opacity-90 dark:ring-white/10"
                />
                <span class="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-xs font-semibold text-white tabular-nums">
                  {i + 1}
                </span>
              </span>
              <span class="mt-1.5 flex items-center gap-1.5">
                <span class="text-base font-semibold tabular-nums">
                  {formatCount(p.pageViews)}
                </span>
                <VisibilityBadge
                  visibility={p.photo.visibility}
                  compact
                  class="shrink-0"
                />
              </span>
              <span class={["block truncate text-xs", muted]}>
                {nameOf(p.photo.path)}
              </span>
            </Link>
          ) : (
            <div title={p.kind === "page" ? p.href : undefined}>
              <span class="relative grid aspect-video w-full place-items-center rounded-lg bg-zinc-50 text-zinc-400 dark:bg-zinc-800/50 dark:text-zinc-500">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  class="size-6"
                >
                  <path d={LINK_OFF} />
                </svg>
                <span class="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/40 text-xs font-semibold text-white tabular-nums">
                  {i + 1}
                </span>
              </span>
              <span class="mt-1.5 block text-base font-semibold tabular-nums">
                {formatCount(p.pageViews)}
              </span>
              <span class={["block truncate text-xs", muted]}>
                {p.kind === "page"
                  ? p.label
                  : p.kind === "gone"
                    ? p.path
                    : "旧 URL"}
              </span>
            </div>
          )}
        </li>
      ))}
    </ol>
  ),
);
