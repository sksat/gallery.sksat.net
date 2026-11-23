import { component$ } from "@builder.io/qwik";
import {
  formatDecimalBytes,
  percentOf,
  type StorageSlice,
  type StorageSummary,
} from "~/lib/storage";
import { card, muted } from "./ui";

const VISIBILITY_ROWS = [
  { key: "public", label: "公開", bar: "bg-sky-500" },
  { key: "unlisted", label: "限定公開", bar: "bg-amber-500" },
  { key: "private", label: "非公開", bar: "bg-zinc-400 dark:bg-zinc-500" },
] as const;

const sliceText = (s: StorageSlice) =>
  `${formatDecimalBytes(s.bytes)} · ${s.count} 枚`;

// One labelled row with its share of the total as a bar. The bar is only
// decoration: the size and count are in the text next to it.
const BarRow = component$<{
  label: string;
  slice: StorageSlice;
  total: number;
  bar: string;
}>(({ label, slice, total, bar }) => (
  <li>
    <div class="flex items-baseline justify-between gap-3 text-sm">
      <span class="min-w-0 truncate font-medium" title={label}>
        {label}
      </span>
      <span class={["shrink-0 tabular-nums", muted]}>{sliceText(slice)}</span>
    </div>
    <div
      aria-hidden="true"
      class="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
    >
      <div
        class={["h-full rounded-full", bar]}
        style={{ width: `${percentOf(slice.bytes, total)}%` }}
      />
    </div>
  </li>
));

export const StorageCard = component$<{
  /** null without a D1 binding; "error" when the query failed. */
  summary: StorageSummary | null | "error";
}>(({ summary }) => {
  const heading = (
    <h2 id="storage-heading" class="text-base font-semibold">
      容量
    </h2>
  );
  if (summary === "error") {
    return (
      <section aria-labelledby="storage-heading" class={[card, "p-5"]}>
        {heading}
        <p class="mt-1 text-sm text-amber-800 dark:text-amber-300">
          容量を取得できませんでした
        </p>
      </section>
    );
  }
  if (!summary) {
    return (
      <section aria-labelledby="storage-heading" class={[card, "p-5"]}>
        {heading}
        <p class={["mt-1 text-sm", muted]}>
          D1 に接続できないため表示できません (<code>pnpm serve</code>{" "}
          か本番で開いてください)。
        </p>
      </section>
    );
  }
  const { total, byVisibility, byFolder, uploading, unsized } = summary;
  return (
    <section aria-labelledby="storage-heading" class={[card, "p-5"]}>
      {heading}
      <p class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="text-3xl font-bold tracking-tight tabular-nums">
          {formatDecimalBytes(total.bytes)}
        </span>
        <span class={["text-sm", muted]}>{total.count} 枚</span>
      </p>
      <div class="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 class="text-sm font-semibold">公開状態別</h3>
          <ul class="mt-2 space-y-3">
            {VISIBILITY_ROWS.map((v) => (
              <BarRow
                key={v.key}
                label={v.label}
                slice={byVisibility[v.key]}
                total={total.bytes}
                bar={v.bar}
              />
            ))}
          </ul>
        </div>
        <div>
          <h3 class="text-sm font-semibold">フォルダ別</h3>
          {byFolder.length === 0 ? (
            <p class={["mt-2 text-sm", muted]}>写真はまだありません。</p>
          ) : (
            <ul class="mt-2 space-y-3">
              {byFolder.map((f) => (
                <BarRow
                  key={f.folder}
                  label={f.folder}
                  slice={f}
                  total={total.bytes}
                  bar="bg-violet-500"
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <p class="mt-5 text-sm">
        <span class="font-semibold">アップロード中</span>{" "}
        <span class={["tabular-nums", muted]}>
          {uploading.count === 0
            ? "なし"
            : `${formatDecimalBytes(uploading.bytes)} · ${uploading.count} 件`}
        </span>
      </p>
      {unsized > 0 && (
        <p class="mt-2 text-sm text-amber-800 dark:text-amber-300">
          サイズが D1 にない写真が {unsized} 枚あり、合計に含まれていません。
        </p>
      )}
      <p class={["mt-4 text-xs leading-relaxed", muted]}>
        写真の元ファイルの D1 にあるサイズ (1 GB = 10<sup>9</sup> バイト)
        の合計です。アップロード中のファイルとカメラの写真 (/camera)
        は含みません。
      </p>
    </section>
  );
});
