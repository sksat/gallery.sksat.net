import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { server$ } from "@builder.io/qwik-city";
import { defaultCache, graphqlEndpoint } from "~/lib/cf-graphql";
import {
  fetchPhotoAccess,
  type PhotoAccessResult,
} from "~/lib/photo-analytics";
import {
  ACCESS_RANGES,
  ACCESS_RANGE_LABELS,
  DEFAULT_ACCESS_RANGE,
  getWebAnalyticsConfig,
  parseAccessRange,
  type AccessRange,
} from "~/lib/web-analytics";
import { AccessUnavailable } from "./access-card";
import {
  BarList,
  countryRows,
  referrerRows,
  SampledBadge,
  segment,
  segmentGroup,
  StatTile,
} from "./access-parts";
import { ColumnChart } from "./column-chart";
import { card, muted } from "./ui";

// A photo's own access numbers on its edit page: its viewer URL and its
// detail page, together and apart, over a chosen range, with the
// referrers and countries of those views (lib/photo-analytics.ts). Asked
// only once the card is on screen, and again when the range changes;
// answers are cached for 5 minutes per photo and range.

const loadPhotoAccess = server$(async function (
  publicId: unknown,
  range: unknown,
): Promise<PhotoAccessResult> {
  if (typeof publicId !== "string") return { kind: "error" };
  const deps = {
    fetch,
    cache: defaultCache(),
    now: new Date(),
    endpoint: graphqlEndpoint(this.platform, this.url),
  };
  return fetchPhotoAccess(
    getWebAnalyticsConfig(this.platform),
    publicId,
    parseAccessRange(typeof range === "string" ? range : null),
    deps,
  );
});

export const PhotoAccess = component$<{ public_id: string }>(
  ({ public_id }) => {
    const range = useSignal<AccessRange>(DEFAULT_ACCESS_RANGE);
    const result = useSignal<PhotoAccessResult | null>(null);
    const loading = useSignal(false);
    // Only the latest request's answer is shown (a slower earlier one,
    // even for the same range, is dropped).
    const seq = useSignal(0);

    const load = $(async (r: AccessRange) => {
      range.value = r;
      loading.value = true;
      const mine = ++seq.value;
      let res: PhotoAccessResult;
      try {
        res = await loadPhotoAccess(public_id, r);
      } catch (err) {
        console.error("photo access:", err);
        res = { kind: "error" };
      }
      if (seq.value === mine) {
        result.value = res;
        loading.value = false;
      }
    });

    // Asks once the card is on screen. (A visible task alone also runs
    // at once when the page is rendered in the browser, e.g. on 次へ.)
    const section = useSignal<HTMLElement>();
    useVisibleTask$(({ cleanup }) => {
      const el = section.value;
      if (!el) return;
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          if (result.value === null && !loading.value) void load(range.value);
        }
      });
      io.observe(el);
      cleanup(() => io.disconnect());
    });

    const res = result.value;
    const r = range.value;
    // Of the numbers shown, which stay while another range loads.
    const unit =
      res?.kind === "ok" && res.stats.range === "24h" ? "時間" : "日";
    return (
      <section
        ref={section}
        aria-labelledby="photo-access-heading"
        aria-busy={loading.value}
        class={[card, "p-5"]}
        data-testid="photo-access"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h2 id="photo-access-heading" class="text-base font-semibold">
              アクセス
            </h2>
            {res?.kind === "ok" && <SampledBadge />}
          </div>
          {res?.kind !== "no-token" && res?.kind !== "no-site-tag" && (
            <div role="group" aria-label="期間" class={segmentGroup}>
              {ACCESS_RANGES.map((x) => (
                <button
                  key={x}
                  type="button"
                  aria-pressed={x === r}
                  class={segment(x === r)}
                  onClick$={() => {
                    if (x !== range.value) void load(x);
                  }}
                >
                  {ACCESS_RANGE_LABELS[x]}
                </button>
              ))}
            </div>
          )}
        </div>

        {res === null ? (
          // Keeps roughly the loaded card's height, so nothing jumps.
          <p class={["mt-3 h-72 text-sm", muted]}>読み込み中…</p>
        ) : res.kind !== "ok" ? (
          <div class="mt-3">
            <AccessUnavailable access={res} />
          </div>
        ) : (
          // While another range loads, the previous one stays, dimmed.
          <div class={["transition-opacity", loading.value && "opacity-50"]}>
            <dl class="mt-3 flex flex-wrap gap-x-10 gap-y-3">
              <StatTile
                label="ページビュー"
                value={res.stats.total.pageViews}
                prev={res.stats.previous.pageViews}
                range={res.stats.range}
                size="md"
              />
              <StatTile
                label="訪問"
                value={res.stats.total.visits}
                prev={res.stats.previous.visits}
                range={res.stats.range}
                size="md"
              />
            </dl>
            <div class="mt-6">
              <ColumnChart
                height="h-32"
                label={`${unit}ごとのページビュー`}
                series={["ビューア", "詳細ページ"]}
                seriesTotals={[res.stats.viewer, res.stats.detail]}
                buckets={res.stats.series.map((b) => ({
                  key: b.key,
                  values: [b.viewer, b.detail],
                }))}
              />
            </div>
            <div class="mt-6 grid gap-6 sm:grid-cols-2">
              <BarList title="参照元" rows={referrerRows(res.stats)} />
              <BarList title="国" rows={countryRows(res.stats)} />
            </div>
          </div>
        )}
      </section>
    );
  },
);
