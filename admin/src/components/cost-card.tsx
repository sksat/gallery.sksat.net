import { component$ } from "@builder.io/qwik";
import { formatCount } from "~/lib/cf-graphql";
import {
  CLOUDFLARE_BILLING_URL,
  type CostRow,
  type CostSummary,
  type Meter,
} from "~/lib/cost";
import { formatDecimalBytes, formatUsd } from "~/lib/storage";
import { card, muted } from "./ui";

const PERIOD = { month: "今月", today: "今日", now: "現在" } as const;

const amount = (m: Meter, v: number) =>
  m.unit === "bytes" ? formatDecimalBytes(v) : formatCount(v);

const meterText = (m: Meter) =>
  m.free === null
    ? amount(m, m.used)
    : `${amount(m, m.used)} / ${amount(m, m.free)}`;

const external = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

const Row = component$<{ row: CostRow }>(({ row }) => {
  const known = row.costUsd !== null;
  return (
    <li class="grid grid-cols-[1fr_auto] gap-x-3 py-2.5" data-cost={row.key}>
      <div class="min-w-0">
        <p class="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span class="font-medium">{row.name}</span>
          {row.period && row.state === "ok" && row.meters.length > 0 && (
            <span class={["text-xs", muted]}>{PERIOD[row.period]}</span>
          )}
          <a
            href={row.pricingUrl}
            class={["text-xs underline underline-offset-2", muted]}
            {...external}
          >
            料金
          </a>
        </p>
        {row.state === "ok" && row.meters.length > 0 && (
          <p
            class={[
              "mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums",
              muted,
            ]}
          >
            {row.meters.map((m) => (
              <span key={m.label}>
                {m.label} {meterText(m)}
              </span>
            ))}
          </p>
        )}
        {row.state === "no-token" && (
          <p class={["mt-0.5 text-xs", muted]}>API トークン設定後に表示</p>
        )}
        {row.state === "no-db" && (
          <p class={["mt-0.5 text-xs", muted]}>D1 に接続できません</p>
        )}
        {row.state === "error" && (
          <p class="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            取得できませんでした
            {!known && (
              <>
                {" "}
                ·{" "}
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
      </div>
      <p
        class={[
          "text-right text-sm tabular-nums",
          known ? "font-semibold" : muted,
        ]}
        data-cost-usd
      >
        {row.alwaysFree ? (
          <span class={["font-normal", muted]}>無料</span>
        ) : known ? (
          formatUsd(row.costUsd!)
        ) : (
          "—"
        )}
      </p>
    </li>
  );
});

export const CostCard = component$<{ summary: CostSummary }>(({ summary }) => (
  <section aria-labelledby="cost-heading" class={[card, "p-5"]}>
    <h2 id="cost-heading" class="text-base font-semibold">
      費用
    </h2>
    <p class="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        class="text-3xl font-bold tracking-tight tabular-nums"
        data-testid="cost-total"
      >
        {formatUsd(summary.totalUsd)}
      </span>
      <span class={["text-sm", muted]}>
        / 月 (見込み){summary.partial && " · 取得できなかった分を除く"}
      </span>
    </p>
    <div
      class={[
        "mt-4 flex justify-between border-b border-zinc-200 pb-1 text-xs dark:border-zinc-800",
        muted,
      ]}
    >
      <span>使用量 (実測)</span>
      <span>月額 (見込み)</span>
    </div>
    <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
      {summary.rows.map((r) => (
        <Row key={r.key} row={r} />
      ))}
    </ul>
  </section>
));
