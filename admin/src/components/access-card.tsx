import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { formatCount } from "~/lib/cf-graphql";
import { percentOf } from "~/lib/storage";
import {
  ACCESS_RANGES,
  ACCESS_RANGE_LABELS,
  countryLabel,
  referrerLabel,
  type AccessRange,
  type AccessResult,
  type AccessStats,
} from "~/lib/web-analytics";
import type { RankedPage } from "~/lib/page-ranking";
import { PageRanking } from "./page-ranking";
import { card, muted } from "./ui";

const bucketLabel = (key: string): string =>
  key.length > 10
    ? `${key.slice(5, 10).replace("-", "/")} ${key.slice(11, 13)}時`
    : key.slice(5).replace("-", "/");

// Page views per bucket as bars. The SVG is a picture of the table next to
// it (sr-only), which carries the numbers.
const Chart = component$<{ stats: AccessStats }>(({ stats }) => {
  const { series } = stats;
  const max = Math.max(1, ...series.map((b) => b.pageViews));
  const w = 10;
  const h = 60;
  const unit = stats.range === "24h" ? "時間" : "日";
  return (
    <figure class="mt-4">
      <svg
        viewBox={`0 0 ${series.length * w} ${h}`}
        preserveAspectRatio="none"
        class="h-24 w-full text-sky-500 dark:text-sky-400"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={h - 0.5}
          x2={series.length * w}
          y2={h - 0.5}
          class="stroke-zinc-200 dark:stroke-zinc-700"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
        {series.map((b, i) => {
          const bh = (b.pageViews / max) * (h - 2);
          return (
            <rect
              key={b.key}
              x={i * w + 1}
              y={h - bh}
              width={w - 2}
              height={bh}
              rx="1"
              fill="currentColor"
            />
          );
        })}
      </svg>
      <figcaption class={["mt-1 flex justify-between text-xs", muted]}>
        {/* data-date: masked in VRT (the window moves with the clock). */}
        <span data-date>{bucketLabel(series[0].key)}</span>
        <span>
          {unit}ごとのページビュー (最大 {formatCount(max)})
        </span>
        <span data-date>{bucketLabel(series[series.length - 1].key)}</span>
      </figcaption>
      <table class="sr-only">
        <caption>{unit}ごとのページビューと訪問</caption>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col">ページビュー</th>
            <th scope="col">訪問</th>
          </tr>
        </thead>
        <tbody>
          {series.map((b) => (
            <tr key={b.key}>
              <th scope="row">{bucketLabel(b.key)}</th>
              <td>{b.pageViews}</td>
              <td>{b.visits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
});

// A ranked list with a bar per row; the count is in the text.
const TopList = component$<{
  title: string;
  rows: { label: string; value: number }[];
  max: number;
}>(({ title, rows, max }) => (
  <div>
    <h3 class="text-sm font-semibold">{title}</h3>
    {rows.length === 0 ? (
      <p class={["mt-2 text-sm", muted]}>なし</p>
    ) : (
      <ol class="mt-2 space-y-2">
        {rows.map((r, i) => (
          <li key={i}>
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="min-w-0 truncate" title={r.label}>
                {r.label}
              </span>
              <span class={["shrink-0 tabular-nums", muted]}>
                {formatCount(r.value)}
              </span>
            </div>
            <div
              aria-hidden="true"
              class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            >
              <div
                class="h-full rounded-full bg-sky-500"
                style={{ width: `${percentOf(r.value, max)}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    )}
  </div>
));

const RangeTabs = component$<{ range: AccessRange }>(({ range }) => (
  <nav aria-label="期間" class="flex gap-1">
    {ACCESS_RANGES.map((r) => (
      <Link
        prefetch="js"
        key={r}
        href={r === "7d" ? "/" : `/?range=${r}`}
        aria-current={r === range ? "page" : undefined}
        class={[
          "inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium sm:h-8",
          r === range
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        ]}
      >
        {ACCESS_RANGE_LABELS[r]}
      </Link>
    ))}
  </nav>
));

export const AccessCard = component$<{
  range: AccessRange;
  access: AccessResult;
  pages: RankedPage[];
  imageBase: string | null;
}>(({ range, access, pages, imageBase }) => (
  <section aria-labelledby="access-heading" class={[card, "p-5"]}>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="access-heading" class="text-base font-semibold">
        アクセス
      </h2>
      {access.kind === "ok" && <RangeTabs range={range} />}
    </div>
    {access.kind === "no-token" && (
      <p class={["mt-1 text-sm", muted]}>
        アクセス数は API トークン設定後に表示
      </p>
    )}
    {access.kind === "no-site-tag" && (
      <p class={["mt-1 text-sm", muted]}>
        アクセス数は Web Analytics のサイトタグとホスト (
        <code>WEB_ANALYTICS_SITE_TAG</code> / <code>WEB_ANALYTICS_HOST</code>)
        設定後に表示
      </p>
    )}
    {access.kind === "error" && (
      <p class="mt-1 text-sm text-amber-800 dark:text-amber-300">
        アクセス数を取得できませんでした
      </p>
    )}
    {access.kind === "ok" && (
      <>
        <dl class="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt class={["text-xs", muted]}>ページビュー</dt>
            <dd class="text-2xl font-bold tabular-nums">
              <span class={["text-sm font-normal", muted]}>約 </span>
              {formatCount(access.stats.total.pageViews)}
            </dd>
          </div>
          <div>
            <dt class={["text-xs", muted]}>訪問</dt>
            <dd class="text-2xl font-bold tabular-nums">
              <span class={["text-sm font-normal", muted]}>約 </span>
              {formatCount(access.stats.total.visits)}
            </dd>
          </div>
        </dl>
        <Chart stats={access.stats} />

        <div class="mt-6">
          <PageRanking pages={pages} imageBase={imageBase} />
        </div>

        <div class="mt-6 grid gap-6 sm:grid-cols-2">
          <TopList
            title="国"
            rows={access.stats.countries.map((c) => ({
              label: countryLabel(c.country),
              value: c.pageViews,
            }))}
            max={access.stats.countries[0]?.pageViews ?? 0}
          />
          <TopList
            title="参照元"
            rows={access.stats.referrers.map((r) => ({
              label: referrerLabel(r.host),
              value: r.pageViews,
            }))}
            max={access.stats.referrers[0]?.pageViews ?? 0}
          />
        </div>
        <p class={["mt-4 text-xs leading-relaxed", muted]}>
          Cloudflare Web Analytics の集計で、標本から推定した概数です
          (期間が長いと 10 単位などの刻みになります)。数分遅れで反映され、5
          分キャッシュします。参照元からはこのサイト・管理画面・Access
          のログインを除いています。国は国単位のみで、IP
          アドレスなど個人を特定する情報は扱いません。
        </p>
      </>
    )}
  </section>
));
