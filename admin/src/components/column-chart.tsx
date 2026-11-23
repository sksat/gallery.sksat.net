import { $, component$, Fragment, sync$, useSignal } from "@builder.io/qwik";
import {
  bucketTitle,
  currentBucketName,
  niceScale,
  timeAxis,
} from "~/lib/chart";
import { formatCount } from "~/lib/cf-graphql";
import { muted } from "./ui";

// Page views over time as columns, one per hour or day, stacked when there
// is more than one series. Built from HTML boxes rather than a scaled SVG,
// so marks and text stay crisp at any width. Hover, a tap or the arrow
// keys (the plot is focusable) show one bucket's numbers; the same numbers
// are in a table for screen readers.

/** Categorical slots 1 and 2 (validated together on the card surfaces). */
export const SERIES_COLORS = [
  "bg-[#2a78d6] dark:bg-[#3987e5]",
  "bg-[#eb6834] dark:bg-[#d95926]",
] as const;

export type ChartBucket = {
  /** A bucket key of web-analytics.ts (JST day or UTC hour). */
  key: string;
  /** One value per series, stacked bottom up. */
  values: number[];
  /** More numbers for the tooltip only (e.g. visits). */
  extra?: number[];
};

type Props = {
  buckets: ChartBucket[];
  /** Series names, in stacking order; a legend shows when there are two. */
  series: string[];
  /** Each series' total over the window, shown in the legend. */
  seriesTotals?: number[];
  /** Names of the tooltip-only numbers. */
  extraNames?: string[];
  /** Accessible name and table caption, e.g. "日ごとのページビュー". */
  label: string;
  /** Plot height class. */
  height?: string;
  /** Hide the axes (the dashboard's small chart). */
  compact?: boolean;
};

export const ColumnChart = component$<Props>(
  ({
    buckets,
    series,
    seriesTotals,
    extraNames = [],
    label,
    height = "h-40",
    compact,
  }) => {
    const active = useSignal<number | null>(null);
    const n = buckets.length;
    const sums = buckets.map((b) => b.values.reduce((s, v) => s + v, 0));
    const { top, ticks } = niceScale(Math.max(0, ...sums));
    const hourly = (buckets[0]?.key.length ?? 10) > 10;
    const axis = timeAxis(buckets.map((bk) => bk.key));
    const midnights = axis.days.filter((d) => d.index > 0);
    // The newest bucket ends now: it is still filling.
    const current = n - 1;
    const titleOf = (k: number) =>
      k === current
        ? `${bucketTitle(buckets[k].key)} (集計中)`
        : bucketTitle(buckets[k].key);
    const total = series.length > 1;

    const pick = $((ev: PointerEvent, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      const i = Math.floor(((ev.clientX - r.left) / r.width) * n);
      active.value = Math.min(n - 1, Math.max(0, i));
    });

    const i = active.value;
    const b = i === null ? null : buckets[i];
    // The tooltip sits over its column, kept inside the plot at the ends.
    const frac = i === null ? 0 : (i + 0.5) / n;
    const tipPos =
      frac < 0.25
        ? { left: `${(i! / n) * 100}%` }
        : frac > 0.75
          ? { right: `${((n - i! - 1) / n) * 100}%` }
          : { left: `${frac * 100}%`, transform: "translateX(-50%)" };

    return (
      <figure>
        {total && (
          <ul class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {series.map((name, s) => (
              <li key={name} class="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  class={["size-2.5 rounded-sm", SERIES_COLORS[s]]}
                />
                <span class={muted}>{name}</span>
                {seriesTotals && (
                  <span class="font-semibold tabular-nums">
                    {formatCount(seriesTotals[s] ?? 0)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div class="flex gap-2">
          {!compact && (
            // Value axis: clean ticks, right-aligned beside the gridlines.
            <div
              aria-hidden="true"
              class={[
                "relative w-8 shrink-0 text-right text-[11px] tabular-nums",
                height,
                muted,
              ]}
            >
              {ticks.map((t) => (
                <span
                  key={t}
                  class="absolute right-0 translate-y-1/2 leading-none"
                  style={{ bottom: `${(t / top) * 100}%` }}
                >
                  {formatCount(t)}
                </span>
              ))}
            </div>
          )}
          <div class="min-w-0 flex-1">
            <div
              class={[
                "relative flex touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
                height,
              ]}
              tabIndex={0}
              role="group"
              aria-label={`${label} (矢印キーで移動)`}
              data-testid="column-chart"
              onPointerMove$={pick}
              onPointerDown$={pick}
              onPointerLeave$={() => (active.value = null)}
              onBlur$={() => (active.value = null)}
              onFocus$={() => {
                if (active.value === null) active.value = n - 1;
              }}
              onKeyDown$={[
                sync$((ev: KeyboardEvent) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)
                  ) {
                    ev.preventDefault();
                  }
                }),
                $((ev: KeyboardEvent) => {
                  const cur = active.value ?? n - 1;
                  if (ev.key === "ArrowLeft")
                    active.value = Math.max(0, cur - 1);
                  else if (ev.key === "ArrowRight")
                    active.value = Math.min(n - 1, cur + 1);
                  else if (ev.key === "Home") active.value = 0;
                  else if (ev.key === "End") active.value = n - 1;
                  else if (ev.key === "Escape") active.value = null;
                }),
              ]}
            >
              {/* Gridlines: hairlines one step off the surface. */}
              {!compact &&
                ticks.map((t) => (
                  <span
                    key={t}
                    aria-hidden="true"
                    class={[
                      "pointer-events-none absolute inset-x-0 h-px",
                      t === 0
                        ? "bg-zinc-300 dark:bg-zinc-600"
                        : "bg-zinc-100 dark:bg-zinc-800",
                    ]}
                    style={{ bottom: `${(t / top) * 100}%` }}
                  />
                ))}
              {compact && (
                <span
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-zinc-200 dark:bg-zinc-700"
                />
              )}
              {/* Midnight (JST) on an hourly chart: a dashed hairline. */}
              {midnights.map((d) => (
                <span
                  key={d.index}
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-y-0 w-0 border-l border-dashed border-zinc-300 dark:border-zinc-600"
                  style={{ left: `${(d.index / n) * 100}%` }}
                  data-testid="chart-midnight"
                  data-clock
                />
              ))}
              {buckets.map((bk, k) => (
                <div
                  key={bk.key}
                  aria-hidden="true"
                  class={[
                    "relative flex h-full flex-1 flex-col items-center justify-end",
                    k === i && "bg-zinc-100/70 dark:bg-zinc-800/60",
                  ]}
                >
                  {/* Columns: at most 24px, 4px round tops, square at the
                      baseline; a 2px gap between stacked parts. */}
                  {/* The newest bucket is still filling: drawn lighter. */}
                  <div
                    class={[
                      "flex w-3/5 max-w-6 flex-col-reverse gap-[2px]",
                      k === current && "opacity-45",
                    ]}
                    style={{ height: `${(sums[k] / top) * 100}%` }}
                    data-current={k === current ? "" : undefined}
                  >
                    {bk.values.map((v, s) =>
                      v > 0 ? (
                        <span
                          key={s}
                          class={[
                            "block min-h-px w-full",
                            SERIES_COLORS[s],
                            // The topmost non-zero part gets the round end.
                            bk.values.slice(s + 1).every((x) => x === 0) &&
                              "rounded-t-[4px]",
                          ]}
                          style={{ flexGrow: v, flexBasis: 0 }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
              {/* What the tooltip shows, read out as the keys move. */}
              <p class="sr-only" aria-live="polite">
                {b
                  ? [
                      titleOf(i!),
                      ...series.map(
                        (name, s) => `${name} ${formatCount(b.values[s] ?? 0)}`,
                      ),
                      ...extraNames.map(
                        (name, x) =>
                          `${name} ${formatCount(b.extra?.[x] ?? 0)}`,
                      ),
                    ].join("、")
                  : ""}
              </p>
              {b && (
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute bottom-full z-10 mb-2 min-w-32 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs whitespace-nowrap shadow-md dark:border-zinc-700 dark:bg-zinc-900"
                  style={tipPos}
                  data-testid="chart-tooltip"
                >
                  <p class={["mb-1", muted]} data-date>
                    {titleOf(i!)}
                  </p>
                  <dl class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5">
                    {total && (
                      <>
                        <dt class={muted}>合計</dt>
                        <dd class="text-right font-semibold tabular-nums">
                          {formatCount(sums[i!])}
                        </dd>
                      </>
                    )}
                    {series.map((name, s) => (
                      <Fragment key={name}>
                        <dt class={["flex items-center gap-1.5", muted]}>
                          {total && (
                            <span
                              aria-hidden="true"
                              class={[
                                "h-0.5 w-3 rounded-full",
                                SERIES_COLORS[s],
                              ]}
                            />
                          )}
                          {name}
                        </dt>
                        <dd
                          class={[
                            "text-right tabular-nums",
                            !total && "font-semibold",
                          ]}
                        >
                          {formatCount(b.values[s] ?? 0)}
                        </dd>
                      </Fragment>
                    ))}
                    {extraNames.map((name, x) => (
                      <Fragment key={name}>
                        <dt class={muted}>{name}</dt>
                        <dd class="text-right tabular-nums">
                          {formatCount(b.extra?.[x] ?? 0)}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              )}
            </div>
            {/* Time axis (timeAxis): hours or dates under their columns,
                then on an hourly chart the days, from their midnight. */}
            <div
              aria-hidden="true"
              class={["relative mt-1 h-4 text-[11px] tabular-nums", muted]}
              data-testid="chart-ticks"
            >
              {axis.ticks.map((t) => (
                <span
                  key={t.index}
                  class="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((t.index + 0.5) / n) * 100}%` }}
                  data-clock
                >
                  {t.label}
                </span>
              ))}
            </div>
            {!compact && axis.days.length > 0 && (
              <div
                aria-hidden="true"
                class="relative h-4 text-[11px] font-medium text-zinc-700 tabular-nums dark:text-zinc-300"
                data-testid="chart-days"
              >
                {axis.days.map((d) => (
                  <span
                    key={d.index}
                    class={[
                      "absolute whitespace-nowrap",
                      d.index > 0 &&
                        "border-l border-dashed border-zinc-300 pl-1 dark:border-zinc-600",
                    ]}
                    style={{ left: `${(d.index / n) * 100}%` }}
                    data-clock
                  >
                    {d.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {!compact && (
          // Which column is still filling, and the time zone, once.
          <figcaption
            class={[
              "mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs",
              muted,
            ]}
          >
            <span class="flex items-center gap-1.5" data-testid="chart-current">
              <span
                aria-hidden="true"
                class={["size-2.5 rounded-sm opacity-45", SERIES_COLORS[0]]}
              />
              {n > 0 && (
                <span>
                  薄い棒は集計中 (
                  <span data-clock>
                    {currentBucketName(buckets[current].key)}
                  </span>
                  )
                </span>
              )}
            </span>
            <span>日本時間 (JST)</span>
          </figcaption>
        )}
        <table class="sr-only">
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">{hourly ? "時間" : "日"}</th>
              {series.map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
              {extraNames.map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((bk, k) => (
              <tr key={bk.key}>
                <th scope="row">{titleOf(k)}</th>
                {series.map((name, s) => (
                  <td key={name}>{bk.values[s] ?? 0}</td>
                ))}
                {extraNames.map((name, x) => (
                  <td key={name}>{bk.extra?.[x] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    );
  },
);
