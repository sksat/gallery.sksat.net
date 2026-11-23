import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { AccessData } from "~/lib/access-load";
import { ACCESS_RANGE_LABELS } from "~/lib/web-analytics";
import { ColumnChart } from "./column-chart";
import {
  BarList,
  countryRows,
  PhotoRanking,
  referrerRows,
  SampledBadge,
  StatTile,
} from "./access-parts";
import { buttonSecondary, card, muted } from "./ui";

/** What the card says when there are no numbers to show. */
export const AccessUnavailable = ({
  access,
}: {
  access: AccessData["access"];
}) => (
  <>
    {access.kind === "no-token" && (
      <p class={["text-sm", muted]}>アクセス数は API トークン設定後に表示</p>
    )}
    {access.kind === "no-site-tag" && (
      <p class={["text-sm", muted]}>
        アクセス数は Web Analytics のサイトタグとホスト (
        <code>WEB_ANALYTICS_SITE_TAG</code> / <code>WEB_ANALYTICS_HOST</code>)
        設定後に表示
      </p>
    )}
    {access.kind === "error" && (
      <p class="text-sm text-amber-800 dark:text-amber-300">
        アクセス数を取得できませんでした
      </p>
    )}
  </>
);

/** How many referrers and countries the dashboard's card lists. */
export const SUMMARY_ROWS = 5;

// The dashboard's summary of the last 24 hours: the two headline numbers
// with their change, the hourly chart with its time axis (as on
// /analytics/), the most viewed photos as a strip, and the first few
// referrers and countries. Every range and full list is on /analytics/.
export const AccessCard = component$<{
  data: AccessData;
  imageBase: string | null;
}>(({ data, imageBase }) => {
  const { access, range, photos } = data;
  return (
    <section aria-labelledby="access-heading" class={[card, "p-5"]}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <h2 id="access-heading" class="text-base font-semibold">
            アクセス
          </h2>
          {access.kind === "ok" && (
            <>
              <span class={["text-sm", muted]}>
                過去 {ACCESS_RANGE_LABELS[range]}
              </span>
              <SampledBadge />
            </>
          )}
        </div>
        {access.kind === "ok" && (
          <Link prefetch="js" href="/analytics/" class={buttonSecondary}>
            詳しく見る →
          </Link>
        )}
      </div>
      {access.kind !== "ok" ? (
        <div class="mt-1">
          <AccessUnavailable access={access} />
        </div>
      ) : (
        <>
          <div class="mt-5 grid gap-x-10 gap-y-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <dl class="flex flex-wrap gap-x-10 gap-y-5 lg:flex-col">
              <StatTile
                label="ページビュー"
                value={access.stats.total.pageViews}
                prev={access.stats.previous.pageViews}
                range={range}
                size="xl"
              />
              <StatTile
                label="訪問"
                value={access.stats.total.visits}
                prev={access.stats.previous.visits}
                range={range}
                size="xl"
              />
            </dl>
            <ColumnChart
              height="h-40"
              label={`${range === "24h" ? "時間" : "日"}ごとのページビュー`}
              series={["ページビュー"]}
              extraNames={["訪問"]}
              buckets={access.stats.series.map((b) => ({
                key: b.key,
                values: [b.pageViews],
                extra: [b.visits],
              }))}
            />
          </div>

          <div class="mt-6 border-t border-zinc-100 pt-5 dark:border-zinc-800">
            <h3 class="mb-3 text-sm font-semibold">よく見られた写真</h3>
            <PhotoRanking
              photos={photos}
              imageBase={imageBase}
              class="grid-cols-3 sm:grid-cols-6"
            />
          </div>

          <div class="mt-6 grid gap-6 border-t border-zinc-100 pt-5 sm:grid-cols-2 sm:gap-10 dark:border-zinc-800">
            <BarList
              title="参照元"
              rows={referrerRows(access.stats).slice(0, SUMMARY_ROWS)}
            />
            <BarList
              title="国"
              rows={countryRows(access.stats).slice(0, SUMMARY_ROWS)}
            />
          </div>
        </>
      )}
    </section>
  );
});
