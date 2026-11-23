import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { AccessUnavailable } from "~/components/access-card";
import {
  BarList,
  countryRows,
  PhotoRanking,
  referrerRows,
  SampledBadge,
  segment,
  segmentGroup,
  StatTile,
} from "~/components/access-parts";
import { ColumnChart } from "~/components/column-chart";
import { PageRanking } from "~/components/page-ranking";
import { WorldMap } from "~/components/world-map";
import { backLink, card } from "~/components/ui";
import { loadAccess, type AccessData } from "~/lib/access-load";
import { defaultCache, graphqlEndpoint } from "~/lib/cf-graphql";
import { getDB, getImageBase } from "~/lib/env";
import {
  ACCESS_RANGES,
  ACCESS_RANGE_LABELS,
  DEFAULT_ACCESS_RANGE,
  parseAccessRange,
  TOP_LIMIT,
} from "~/lib/web-analytics";

// The public site's access numbers in full: a range, the headline numbers
// with their change, the chart, the most viewed photos and pages, the
// referrers, and the countries as a map and a list. The dashboard shows a
// summary of the default range's (cached) answer.

export const useAnalytics = routeLoader$<
  AccessData & { imageBase: string | null }
>(async ({ platform, url }) => {
  let db: D1Database | null = null;
  try {
    db = getDB(platform);
  } catch (err) {
    console.error("/analytics loader: getDB failed:", err);
  }
  const data = await loadAccess(
    platform,
    db,
    parseAccessRange(url.searchParams.get("range")),
    {
      fetch,
      cache: defaultCache(),
      now: new Date(),
      endpoint: graphqlEndpoint(platform, url),
    },
    { photos: TOP_LIMIT, pages: TOP_LIMIT },
    "/analytics loader",
  );
  return { ...data, imageBase: getImageBase(platform) };
});

export default component$(() => {
  const data = useAnalytics().value;
  const { access, range } = data;
  const unit = range === "24h" ? "時間" : "日";
  return (
    <div class="space-y-6">
      <div>
        <Link prefetch="js" href="/" class={backLink}>
          ← Dashboard
        </Link>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
              アクセス
            </h1>
            {access.kind === "ok" && <SampledBadge />}
          </div>
          {access.kind === "ok" && (
            <nav aria-label="期間" class={segmentGroup}>
              {ACCESS_RANGES.map((r) => (
                <Link
                  prefetch="js"
                  key={r}
                  href={
                    r === DEFAULT_ACCESS_RANGE
                      ? "/analytics/"
                      : `/analytics/?range=${r}`
                  }
                  scroll={false}
                  aria-current={r === range ? "page" : undefined}
                  class={segment(r === range)}
                >
                  {ACCESS_RANGE_LABELS[r]}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>

      {access.kind !== "ok" ? (
        <section class={[card, "p-5"]}>
          <AccessUnavailable access={access} />
        </section>
      ) : (
        <>
          <section aria-label="推移" class={[card, "p-5"]}>
            <dl class="flex flex-wrap gap-x-10 gap-y-3">
              <StatTile
                label="ページビュー"
                value={access.stats.total.pageViews}
                prev={access.stats.previous.pageViews}
                range={range}
              />
              <StatTile
                label="訪問"
                value={access.stats.total.visits}
                prev={access.stats.previous.visits}
                range={range}
              />
            </dl>
            <div class="mt-8">
              <ColumnChart
                height="h-48"
                label={`${unit}ごとのページビュー`}
                series={["ページビュー"]}
                extraNames={["訪問"]}
                buckets={access.stats.series.map((b) => ({
                  key: b.key,
                  values: [b.pageViews],
                  extra: [b.visits],
                }))}
              />
            </div>
          </section>

          <section aria-labelledby="photos-heading" class={[card, "p-5"]}>
            <h2 id="photos-heading" class="mb-3 text-base font-semibold">
              よく見られた写真
            </h2>
            <PhotoRanking
              photos={data.photos}
              imageBase={data.imageBase}
              class="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
            />
          </section>

          <div class="grid gap-6 lg:grid-cols-2">
            <section aria-label="ページ" class={[card, "p-5"]}>
              <PageRanking pages={data.pages} imageBase={data.imageBase} />
            </section>
            <section aria-label="参照元" class={[card, "p-5"]}>
              <BarList title="参照元" rows={referrerRows(access.stats)} />
            </section>
          </div>

          <section aria-labelledby="countries-heading" class={[card, "p-5"]}>
            <h2 id="countries-heading" class="mb-3 text-base font-semibold">
              国
            </h2>
            <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <WorldMap countries={access.stats.countries} />
              <BarList rows={countryRows(access.stats)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
});

export const head: DocumentHead = {
  title: "アクセス - Gallery Admin",
};
