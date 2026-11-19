import { component$ } from "@builder.io/qwik";

import {
  WEEKDAYS,
  type MonthView,
  type YearMonth,
  type YearView,
} from "@shared/calendar/calendar";

import { TopLine } from "../layout/site-nav";
import { calendarHref, dateGalleryHref } from "./calendar";
import { imageUrl, type ImageSource } from "./images";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

// Plain <a>s throughout: see the note in components/layout/header.tsx.

const navLink =
  "inline-flex min-h-11 items-center rounded px-2 text-sm opacity-80 hover:bg-white/10 hover:opacity-100";

/** "‹ 11月" / "2024年1月 ›": the year only when it differs. */
const monthLabel = (to: YearMonth, from: number) =>
  to.year === from ? `${to.month}月` : `${to.year}年${to.month}月`;

/**
 * One month: a Sunday-first grid; a day with photos shows its first
 * photo and the count and opens the gallery of that day.
 */
export const MonthCalendar = component$<{ view: MonthView<ImageSource> }>(
  ({ view }) => {
    const { year, month, prev, next } = view;
    return (
      <div class="mx-auto max-w-3xl px-2 py-3 sm:px-3">
        <TopLine />
        <nav
          aria-label="月を移動"
          class="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"
        >
          <span>
            {prev && (
              <a
                href={calendarHref(prev.year, prev.month)}
                data-testid="calendar-prev"
                rel="prev"
                class={navLink}
              >
                ‹ {monthLabel(prev, year)}
              </a>
            )}
          </span>
          <h1
            data-testid="calendar-title"
            class="text-center text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            <a
              href={calendarHref(year)}
              // Inline: the site's unlayered `a { color }` beats utilities.
              style={{ color: "inherit" }}
              class="underline decoration-white/30 underline-offset-4 hover:decoration-white"
            >
              {year}年
            </a>
            {month}月
          </h1>
          <span class="text-right">
            {next && (
              <a
                href={calendarHref(next.year, next.month)}
                data-testid="calendar-next"
                rel="next"
                class={navLink}
              >
                {monthLabel(next, year)} ›
              </a>
            )}
          </span>
        </nav>
        <table class="w-full table-fixed border-separate border-spacing-0.5 sm:border-spacing-1">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  class="pb-1 text-xs font-normal opacity-70"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.weeks.map((week, i) => (
              <tr key={i}>
                {week.map((cell, j) =>
                  cell === null ? (
                    <td key={`x${j}`} />
                  ) : (
                    <td key={cell.key} class="p-0">
                      {cell.count > 0 && cell.cover ? (
                        <a
                          href={dateGalleryHref(cell.key)}
                          data-testid="calendar-day"
                          data-date={cell.key}
                          aria-label={`${month}月${cell.day}日 ${cell.count}枚`}
                          class="group relative block aspect-square overflow-hidden rounded bg-white/10 outline-offset-2"
                        >
                          <img
                            src={imageUrl(
                              S3_BASE,
                              cell.cover,
                              IMAGE_BASE,
                              "h240",
                            )}
                            alt=""
                            width={120}
                            height={120}
                            loading="lazy"
                            decoding="async"
                            class="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                          <span class="absolute top-0.5 left-1 text-xs font-semibold text-white [text-shadow:0_0_3px_black,0_0_2px_black] sm:text-sm">
                            {cell.day}
                          </span>
                          <span class="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[11px] leading-4 text-white tabular-nums sm:text-xs">
                            {cell.count}
                          </span>
                        </a>
                      ) : (
                        <div class="aspect-square rounded bg-white/[0.03] px-1 pt-0.5 text-xs opacity-50 sm:text-sm">
                          {cell.day}
                        </div>
                      )}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p class="mt-4 px-1 text-sm">
          {view.count > 0 ? (
            <a
              href={dateGalleryHref(view.key)}
              data-testid="calendar-month-all"
              class="underline underline-offset-4"
            >
              {month}月の写真 {view.count} 枚
              {view.undated > 0 && `（うち日付なし ${view.undated} 枚）`}
            </a>
          ) : (
            <span class="opacity-70">この月の写真はありません。</span>
          )}
        </p>
      </div>
    );
  },
);

const HEAT = [
  "bg-white/[0.06]",
  "bg-[var(--color-accent)]/45",
  "bg-[var(--color-accent)]/60",
  "bg-[var(--color-accent)]/80",
  "bg-[var(--color-accent)]",
];

/**
 * One year: twelve small months, each day shaded by how many photos it
 * has (darker = more); a day with photos opens its gallery, a month's
 * name its calendar.
 */
export const YearCalendar = component$<{ view: YearView }>(({ view }) => {
  const { year, prev, next } = view;
  return (
    <div class="mx-auto max-w-5xl px-2 py-3 sm:px-3">
      <TopLine />
      <nav
        aria-label="年を移動"
        class="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"
      >
        <span>
          {prev !== null && (
            <a
              href={calendarHref(prev)}
              data-testid="calendar-prev"
              rel="prev"
              class={navLink}
            >
              ‹ {prev}年
            </a>
          )}
        </span>
        <h1
          data-testid="calendar-title"
          class="text-center text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {year}年
        </h1>
        <span class="text-right">
          {next !== null && (
            <a
              href={calendarHref(next)}
              data-testid="calendar-next"
              rel="next"
              class={navLink}
            >
              {next}年 ›
            </a>
          )}
        </span>
      </nav>
      <p class="mb-4 px-1 text-sm">
        {view.count > 0 ? (
          <a
            href={dateGalleryHref(view.key)}
            class="underline underline-offset-4"
          >
            {year}年の写真 {view.count} 枚
            {view.undated > 0 && `（うち月日なし ${view.undated} 枚）`}
          </a>
        ) : (
          <span class="opacity-70">この年の写真はありません。</span>
        )}
      </p>
      <ol class="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {view.months.map((m) => (
          <li key={m.key} data-testid="calendar-month">
            <div class="mb-1 flex items-baseline justify-between px-0.5 text-sm">
              {m.count > 0 ? (
                <a
                  href={calendarHref(year, m.month)}
                  style={{ color: "inherit" }}
                  class="font-semibold underline decoration-white/30 underline-offset-4 hover:decoration-white"
                >
                  {m.month}月
                </a>
              ) : (
                <span class="font-semibold opacity-60">{m.month}月</span>
              )}
              {m.count > 0 && (
                <span class="text-xs tabular-nums opacity-70">
                  {m.count} 枚
                </span>
              )}
            </div>
            <div class="grid grid-cols-7 gap-0.5">
              {m.weeks
                .flat()
                .map((cell, i) =>
                  cell === null ? (
                    <span key={`x${i}`} aria-hidden="true" />
                  ) : cell.count > 0 ? (
                    <a
                      key={cell.key}
                      href={dateGalleryHref(cell.key)}
                      data-testid="calendar-heat-day"
                      data-date={cell.key}
                      aria-label={`${m.month}月${cell.day}日 ${cell.count}枚`}
                      title={`${m.month}月${cell.day}日 ${cell.count}枚`}
                      class={[
                        "block aspect-square rounded-sm outline-offset-1 hover:ring-2 hover:ring-white focus-visible:outline-2 focus-visible:outline-white",
                        HEAT[cell.level],
                      ]}
                    />
                  ) : (
                    <span
                      key={cell.key}
                      aria-hidden="true"
                      class={["block aspect-square rounded-sm", HEAT[0]]}
                    />
                  ),
                )}
            </div>
          </li>
        ))}
      </ol>
      <div
        aria-hidden="true"
        class="mt-5 flex items-center justify-end gap-1 px-1 text-xs opacity-70"
      >
        少
        {HEAT.map((c) => (
          <span key={c} class={["inline-block size-3 rounded-sm", c]} />
        ))}
        多
      </div>
    </div>
  );
});

/** No photo has a public date (or there are no photos). */
export const EmptyCalendar = component$(() => (
  <div class="mx-auto max-w-3xl px-2 py-3 sm:px-3">
    <TopLine />
    <h1 class="px-1 text-2xl font-semibold tracking-tight sm:text-3xl">
      カレンダー
    </h1>
    <p class="mt-4 opacity-80">撮影日のわかる写真がまだありません。</p>
  </div>
));
