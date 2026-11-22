import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { AccessData } from "~/lib/access-load";
import { ColumnChart } from "./column-chart";
import { PhotoRanking, SampledBadge, StatTile } from "./access-parts";
import { card, link, muted } from "./ui";

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

// The dashboard's summary of the last 7 days: the two headline numbers
// with their change, a small chart and the most viewed photos. The rest
// (other ranges, pages, referrers, countries) is on /analytics/.
export const AccessCard = component$<{
  data: AccessData;
  imageBase: string | null;
}>(({ data, imageBase }) => {
  const { access, range, photos } = data;
  return (
    <section aria-labelledby="access-heading" class={[card, "p-5"]}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <h2 id="access-heading" class="text-base font-semibold">
            アクセス
          </h2>
          {access.kind === "ok" && (
            <>
              <span class={["text-sm", muted]}>過去 7 日</span>
              <SampledBadge />
            </>
          )}
        </div>
        {access.kind === "ok" && (
          <Link prefetch="js" href="/analytics/" class={[link, "text-sm"]}>
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
          <div class="mt-3 grid items-end gap-x-8 gap-y-4 sm:grid-cols-[auto_1fr]">
            <dl class="flex gap-8">
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
            <ColumnChart
              compact
              height="h-16"
              label="日ごとのページビュー"
              series={["ページビュー"]}
              extraNames={["訪問"]}
              buckets={access.stats.series.map((b) => ({
                key: b.key,
                values: [b.pageViews],
                extra: [b.visits],
              }))}
            />
          </div>
          <h3 class="mt-6 mb-2 text-sm font-semibold">よく見られた写真</h3>
          <PhotoRanking
            photos={photos}
            imageBase={imageBase}
            class="grid-cols-2 sm:grid-cols-4"
          />
        </>
      )}
    </section>
  );
});
