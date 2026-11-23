import { component$, type JSXOutput } from "@builder.io/qwik";
import { formatCount } from "~/lib/cf-graphql";
import {
  CLOUDFLARE_BILLING_URL,
  meterLevel,
  type CostRow,
  type CostSummary,
  type Meter,
} from "~/lib/cost";
import { formatDecimalBytes, formatUsd, percentOf } from "~/lib/storage";
import { card, muted } from "./ui";

// The month's total, a stacked bar of what each charged service adds to
// it, and one tile per service with its estimate and its usage against
// the free tier. Usage is measured; charges (marked ≈) are estimates.

type Key = CostRow["key"];

// Series colours for the services that can cost money, in a fixed order
// (the first three slots of the dataviz reference palette, light / dark).
const SERIES: Partial<Record<Key, string>> = {
  b2: "bg-[#2a78d6] dark:bg-[#3987e5]",
  r2: "bg-[#eb6834] dark:bg-[#d95926]",
  images: "bg-[#1baf7a] dark:bg-[#199e70]",
};

const SHORT: Partial<Record<Key, string>> = { images: "画像変換" };

const PERIOD = { month: "今月", today: "今日", now: "現在" } as const;

// Small line icons (24×24, stroked with the text colour).
const ICON_PATHS: Record<Key, JSXOutput> = {
  // A stack of disks: stored files.
  b2: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  // A bucket.
  r2: (
    <>
      <path d="M3 6h18l-2 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L3 6Z" />
      <path d="M3 6c0-1.7 4-3 9-3s9 1.3 9 3" />
    </>
  ),
  // A picture with a resize corner.
  images: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="m3 14 4-4 4 4 2-2 4 4" />
      <path d="M15 21h6v-6M21 21l-5-5" />
    </>
  ),
  // Rows of a table.
  d1: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14h18M9 9v11" />
    </>
  ),
  // A bolt: requests served.
  workers: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  free: <path d="M5 12l4 4 10-10" />,
};

const Icon = component$<{ k: Key; class?: string }>(({ k, class: c }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class={c}
  >
    {ICON_PATHS[k]}
  </svg>
));

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

const amount = (m: Meter, v: number) =>
  m.unit === "bytes" ? formatDecimalBytes(v) : formatCount(v);

/** "≈ $0.24": an estimate, said in words to screen readers. */
const Estimate = component$<{ usd: number; class?: string }>(
  ({ usd, class: c }) => {
    const text = formatUsd(usd);
    return (
      <span class={c}>
        {/* "< $0.01" already reads as an approximation. */}
        {!text.startsWith("<") && (
          <span aria-hidden="true" class="mr-0.5 font-normal opacity-60">
            ≈
          </span>
        )}
        <span class="sr-only">見込み </span>
        {text}
      </span>
    );
  },
);

// Neutral until 80% of the free tier, then amber, red past it; the state
// is also said in text next to the numbers.
const MeterRow = component$<{ m: Meter; alwaysFree: boolean }>(
  ({ m, alwaysFree }) => {
    const level = meterLevel(m);
    return (
      <li>
        <div class="flex items-baseline justify-between gap-2 text-xs">
          <span class={muted}>{m.label}</span>
          <span class="tabular-nums">
            {level === "near" && (
              <span class="mr-1.5 font-medium text-amber-700 dark:text-amber-300">
                上限間近
              </span>
            )}
            {level === "over" && (
              <span class="mr-1.5 font-medium text-red-700 dark:text-red-300">
                {alwaysFree ? "上限超過" : "無料枠超過"}
              </span>
            )}
            {amount(m, m.used)}
            {m.free !== null && (
              <span class={muted}> / {amount(m, m.free)}</span>
            )}
          </span>
        </div>
        {m.free !== null && (
          <div
            aria-hidden="true"
            class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800"
          >
            <div
              class={[
                "h-full rounded-full",
                level === "over"
                  ? "bg-red-500"
                  : level === "near"
                    ? "bg-amber-500"
                    : "bg-zinc-400 dark:bg-zinc-500",
              ]}
              style={{ width: `${percentOf(m.used, m.free)}%` }}
            />
          </div>
        )}
      </li>
    );
  },
);

const Tile = component$<{ row: CostRow }>(({ row }) => {
  const id = `cost-${row.key}`;
  const series = SERIES[row.key];
  return (
    // An article, not a region: the page's own cards are the regions
    // (one of them is named D1 too).
    <article
      aria-labelledby={id}
      class="flex flex-col rounded-lg border border-zinc-200 bg-zinc-50/60 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/40"
    >
      <div class="flex items-center gap-2">
        <span
          class={[
            "grid size-7 shrink-0 place-items-center rounded-md",
            series
              ? "bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700"
              : "text-zinc-400 dark:text-zinc-500",
          ]}
        >
          <Icon k={row.key} class="size-4" />
        </span>
        <h3 id={id} class="min-w-0 truncate text-sm font-medium">
          {row.name}
        </h3>
        {series && (
          <span
            aria-hidden="true"
            class={["size-2 shrink-0 rounded-full", series]}
          />
        )}
        <a
          href={row.pricingUrl}
          {...external}
          aria-label={`${row.name} の料金`}
          title="料金"
          class="-m-1.5 ml-auto grid size-8 shrink-0 place-items-center rounded text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            class="size-3.5"
          >
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      </div>

      <p class="mt-2 flex items-baseline gap-1.5" data-cost-usd>
        {row.alwaysFree ? (
          <span class="text-lg font-semibold">無料</span>
        ) : row.costUsd !== null ? (
          <Estimate
            usd={row.costUsd}
            class="text-lg font-semibold tabular-nums"
          />
        ) : (
          <span class={["text-lg font-semibold", muted]}>—</span>
        )}
        {row.period && row.state === "ok" && row.meters.length > 0 && (
          <span class={["text-xs", muted]}>{PERIOD[row.period]}の使用量</span>
        )}
      </p>

      {row.state === "ok" && row.meters.length > 0 && (
        <ul class="mt-2 space-y-2">
          {row.meters.map((m) => (
            <MeterRow key={m.label} m={m} alwaysFree={row.alwaysFree} />
          ))}
        </ul>
      )}
      {row.state === "ok" &&
        row.meters.length > 0 &&
        row.meters.every((m) => m.free === null) && (
          <p class={["mt-1 text-xs", muted]}>無料枠なし</p>
        )}
      {row.state === "no-token" && (
        <p class={["mt-2 text-xs", muted]}>API トークン設定後に表示</p>
      )}
      {row.state === "no-db" && (
        <p class={["mt-2 text-xs", muted]}>D1 に接続できません</p>
      )}
      {row.state === "error" && (
        <p class="mt-2 text-xs text-amber-800 dark:text-amber-300">
          取得できませんでした
          {row.costUsd === null && (
            <>
              {" "}
              <a
                href={CLOUDFLARE_BILLING_URL}
                class="underline underline-offset-2"
                {...external}
              >
                Cloudflare の請求画面で確認
              </a>
            </>
          )}
        </p>
      )}
    </article>
  );
});

export const CostCard = component$<{ summary: CostSummary }>(({ summary }) => {
  const charged = summary.rows.filter((r) => SERIES[r.key]);
  const total = summary.totalUsd;
  return (
    <section aria-labelledby="cost-heading" class={[card, "p-5"]}>
      <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id="cost-heading" class="text-base font-semibold">
            費用
          </h2>
          <p class="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span data-testid="cost-total">
              <Estimate
                usd={total}
                class="text-3xl font-bold tracking-tight tabular-nums"
              />
            </span>
            <span class={["text-sm", muted]}>/ 月</span>
          </p>
          {summary.partial && (
            <p class={["mt-0.5 text-xs", muted]}>取得できなかった分を除く</p>
          )}
        </div>

        {/* What each charged service adds to the total. The legend
            carries the numbers; the bar is decoration. */}
        <div class="w-full sm:w-auto sm:max-w-md sm:min-w-80 sm:flex-1">
          <div
            aria-hidden="true"
            class="flex h-3 gap-0.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            data-testid="cost-bar"
          >
            {total > 0 &&
              charged.map((r) =>
                r.costUsd ? (
                  <div
                    key={r.key}
                    class={["h-full", SERIES[r.key]]}
                    style={{ width: `${percentOf(r.costUsd, total)}%` }}
                    title={`${r.name} ${formatUsd(r.costUsd)}`}
                  />
                ) : null,
              )}
          </div>
          <ul
            aria-label="サービス別の見込み"
            class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
          >
            {charged.map((r) => (
              <li key={r.key} class="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  class={["size-2 rounded-full", SERIES[r.key]]}
                />
                <span class={muted}>{SHORT[r.key] ?? r.name}</span>
                <span class="tabular-nums">
                  {r.costUsd === null ? "—" : <Estimate usd={r.costUsd} />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.rows.map((r) => (
          <Tile key={r.key} row={r} />
        ))}
      </div>

      <p class={["mt-3 text-xs", muted]}>≈ は見込み、使用量は実測です。</p>
    </section>
  );
});
