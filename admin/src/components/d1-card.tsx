import { component$ } from "@builder.io/qwik";
import {
  D1_FREE_MAX_DB_BYTES,
  D1_FREE_ROWS_READ_PER_DAY,
  D1_FREE_ROWS_WRITTEN_PER_DAY,
  type D1UsageResult,
} from "~/lib/d1-usage";
import { formatCount } from "~/lib/cf-graphql";
import { formatDecimalBytes, formatPercent, percentOf } from "~/lib/storage";
import { card, muted } from "./ui";

// A value against a Free plan limit. The bar is decoration (aria-hidden);
// the value, limit and share are in the text.
const LimitRow = component$<{
  label: string;
  value: string;
  limit: string;
  part: number;
  whole: number;
}>(({ label, value, limit, part, whole }) => (
  <li>
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
      <span class="font-medium">{label}</span>
      <span class={["tabular-nums", muted]}>
        {value} / {limit} ({formatPercent(part, whole)})
      </span>
    </div>
    <div
      aria-hidden="true"
      class="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
    >
      <div
        class={[
          "h-full rounded-full",
          part >= whole * 0.8 ? "bg-red-500" : "bg-emerald-500",
        ]}
        style={{ width: `${percentOf(part, whole)}%` }}
      />
    </div>
  </li>
));

export const D1Card = component$<{
  dbBytes: number | null;
  usage: D1UsageResult;
}>(({ dbBytes, usage }) => (
  <section aria-labelledby="d1-heading" class={[card, "p-5"]}>
    <h2 id="d1-heading" class="text-base font-semibold">
      D1
    </h2>
    <ul class="mt-3 space-y-3">
      {dbBytes === null ? (
        <li class={["text-sm", muted]}>データベースのサイズ: 不明</li>
      ) : (
        <LimitRow
          label="データベースのサイズ"
          value={formatDecimalBytes(dbBytes)}
          limit={formatDecimalBytes(D1_FREE_MAX_DB_BYTES)}
          part={dbBytes}
          whole={D1_FREE_MAX_DB_BYTES}
        />
      )}
      {usage.kind === "ok" && (
        <>
          <LimitRow
            label="今日の読み取り行数"
            value={formatCount(usage.usage.rowsRead)}
            limit={formatCount(D1_FREE_ROWS_READ_PER_DAY)}
            part={usage.usage.rowsRead}
            whole={D1_FREE_ROWS_READ_PER_DAY}
          />
          <LimitRow
            label="今日の書き込み行数"
            value={formatCount(usage.usage.rowsWritten)}
            limit={formatCount(D1_FREE_ROWS_WRITTEN_PER_DAY)}
            part={usage.usage.rowsWritten}
            whole={D1_FREE_ROWS_WRITTEN_PER_DAY}
          />
        </>
      )}
    </ul>
    {usage.kind === "ok" && (
      <p class={["mt-3 text-xs", muted]}>
        <span data-date>{usage.usage.date}</span> (UTC) のクエリ{" "}
        {formatCount(usage.usage.readQueries)} 件 (読み取り) /{" "}
        {formatCount(usage.usage.writeQueries)} 件 (書き込み)。 上限は毎日 00:00
        UTC にリセットされます。数分遅れて反映されます。
      </p>
    )}
    {usage.kind === "no-token" && (
      <p class={["mt-3 text-sm", muted]}>
        読み書きの回数は API トークン設定後に表示
      </p>
    )}
    {usage.kind === "error" && (
      <p class="mt-3 text-sm text-amber-800 dark:text-amber-300">
        読み書きの回数を取得できませんでした
      </p>
    )}
    <p class={["mt-3 text-xs leading-relaxed", muted]}>
      上限は Workers Free プランのもの (
      <a
        href="https://developers.cloudflare.com/d1/platform/limits/"
        class="underline underline-offset-2"
        target="_blank"
        rel="noopener noreferrer"
      >
        D1 の制限
      </a>
      )。
    </p>
  </section>
));
