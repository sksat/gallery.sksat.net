import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

import {
  WEEKDAYS,
  type MonthView,
  type YearMonth,
  type YearView,
} from "@shared/calendar/calendar";
import { calendarHref, type CalendarCover } from "~/lib/calendar";
import { mediaListHref } from "~/lib/format";
import { imageUrl } from "~/lib/images";
import { platformOf } from "~/lib/platform";
import { usePlatformList } from "~/routes/layout";
import { VISIBILITIES, type Visibility } from "~/lib/types";
import { muted } from "./ui";
import {
  VISIBILITY_LABELS_JA,
  VISIBILITY_STYLE,
  VisibilityIcon,
} from "./visibility-style";

// The admin's calendar: like the public one (src/components/gallery/
// calendar-view.tsx at the repo root) but over every photo, private ones
// too, with the visibility of each day's photos; a day opens /media
// filtered to it.

const navLink =
  "inline-flex h-11 items-center rounded-lg px-2 text-sm font-medium text-sky-700 hover:bg-zinc-100 sm:h-9 dark:text-sky-400 dark:hover:bg-zinc-800";

const monthLabel = (to: YearMonth, from: number) =>
  to.year === from ? `${to.month}月` : `${to.year}年${to.month}月`;

/** Visibilities on a day, most public first. */
const kindsOf = (kinds: Record<string, number>) =>
  [...VISIBILITIES]
    .reverse()
    .filter((v) => (kinds[v] ?? 0) > 0)
    .map((v) => ({ v: v as Visibility, n: kinds[v] }));

const Nav = component$<{
  label: string;
  prev: { href: string; label: string } | null;
  next: { href: string; label: string } | null;
  up?: { href: string; label: string };
}>(({ label, prev, next, up }) => (
  <nav
    aria-label="移動"
    class="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
  >
    <span>
      {prev && (
        <Link
          prefetch="js"
          key={prev.href}
          href={prev.href}
          data-testid="calendar-prev"
          class={navLink}
        >
          ‹ {prev.label}
        </Link>
      )}
    </span>
    <h1
      data-testid="calendar-title"
      class="text-center text-2xl font-bold tracking-tight sm:text-3xl"
    >
      {up ? (
        <>
          <Link
            prefetch="js"
            key={up.href}
            href={up.href}
            // A 44px-tall hit area on phones.
            class="inline-block py-1.5 underline decoration-zinc-300 underline-offset-4 hover:decoration-current sm:py-0 dark:decoration-zinc-600"
          >
            {up.label}
          </Link>
          {label}
        </>
      ) : (
        label
      )}
    </h1>
    <span class="text-right">
      {next && (
        <Link
          prefetch="js"
          key={next.href}
          href={next.href}
          data-testid="calendar-next"
          class={navLink}
        >
          {next.label} ›
        </Link>
      )}
    </span>
  </nav>
));

export const AdminMonthCalendar = component$<{
  view: MonthView<CalendarCover>;
  imageBase: string | null;
}>(({ view, imageBase }) => {
  const platforms = usePlatformList().value;
  const { year, month, prev, next } = view;
  return (
    <div class="mx-auto max-w-3xl space-y-4">
      <Nav
        label={`${month}月`}
        up={{ href: calendarHref(year), label: `${year}年` }}
        prev={
          prev && {
            href: calendarHref(prev.year, prev.month),
            label: monthLabel(prev, year),
          }
        }
        next={
          next && {
            href: calendarHref(next.year, next.month),
            label: monthLabel(next, year),
          }
        }
      />
      <table class="w-full table-fixed border-separate border-spacing-0.5 sm:border-spacing-1">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th
                key={d}
                scope="col"
                class={["pb-1 text-xs font-normal", muted]}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.weeks.map((week, i) => (
            <tr key={i}>
              {week.map((cell, j) => {
                if (cell === null) return <td key={`x${j}`} />;
                if (cell.count === 0 || !cell.cover) {
                  return (
                    <td key={cell.key} class="p-0">
                      <div class="aspect-square rounded-md bg-zinc-100 px-1 pt-0.5 text-xs text-zinc-500 sm:text-sm dark:bg-zinc-900 dark:text-zinc-400">
                        {cell.day}
                      </div>
                    </td>
                  );
                }
                const kinds = kindsOf(cell.kinds);
                const cover = cell.cover;
                const href = mediaListHref({ date: cell.key });
                return (
                  <td key={cell.key} class="p-0">
                    <Link
                      prefetch="js"
                      key={href}
                      href={href}
                      data-testid="calendar-day"
                      data-date={cell.key}
                      aria-label={`${month}月${cell.day}日 ${cell.count}枚（${kinds
                        .map(({ v, n }) => `${VISIBILITY_LABELS_JA[v]} ${n}`)
                        .join("・")}）`}
                      class="group relative block aspect-square overflow-hidden rounded-md bg-zinc-200 ring-sky-500 hover:ring-2 dark:bg-zinc-800"
                    >
                      {imageBase ? (
                        <img
                          src={imageUrl(imageBase, cover.file, "h240")}
                          alt=""
                          width={120}
                          height={120}
                          loading="lazy"
                          decoding="async"
                          class="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          data-testid="thumb-placeholder"
                          class={[
                            "absolute inset-0",
                            platformOf(platforms, cover.platform).kind ===
                            "virtual"
                              ? "bg-violet-200 dark:bg-violet-900"
                              : "bg-emerald-200 dark:bg-emerald-900",
                          ]}
                        />
                      )}
                      <span class="absolute top-0.5 left-1 text-xs font-semibold text-white [text-shadow:0_0_3px_black,0_0_2px_black] sm:text-sm">
                        {cell.day}
                      </span>
                      <span class="absolute bottom-0.5 left-0.5 flex gap-px rounded bg-white/90 p-px dark:bg-zinc-950/80">
                        {kinds.map(({ v }) => (
                          <span key={v} class={VISIBILITY_STYLE[v].accent}>
                            <VisibilityIcon visibility={v} class="size-3" />
                          </span>
                        ))}
                      </span>
                      <span class="absolute right-0.5 bottom-0.5 rounded bg-zinc-950/75 px-1 text-[11px] leading-4 text-white tabular-nums sm:text-xs">
                        {cell.count}
                      </span>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="text-sm">
        {view.count > 0 ? (
          <Link
            prefetch="js"
            key={view.key}
            href={mediaListHref({ date: view.key })}
            data-testid="calendar-month-all"
            class="font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400"
          >
            {month}月の写真 {view.count} 枚
          </Link>
        ) : (
          <span class={muted}>この月の写真はありません。</span>
        )}
      </p>
    </div>
  );
});

const HEAT = [
  "bg-zinc-100 dark:bg-zinc-800/70",
  "bg-sky-200 dark:bg-sky-900",
  "bg-sky-300 dark:bg-sky-700",
  "bg-sky-500 dark:bg-sky-500",
  "bg-sky-700 dark:bg-sky-300",
];

export const AdminYearCalendar = component$<{ view: YearView }>(({ view }) => {
  const { year, prev, next } = view;
  return (
    <div class="mx-auto max-w-5xl space-y-4">
      <Nav
        label={`${year}年`}
        prev={
          prev === null
            ? null
            : { href: calendarHref(prev), label: `${prev}年` }
        }
        next={
          next === null
            ? null
            : { href: calendarHref(next), label: `${next}年` }
        }
      />
      <p class="text-sm">
        {view.count > 0 ? (
          <Link
            prefetch="js"
            key={view.key}
            href={mediaListHref({ date: view.key })}
            class="font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400"
          >
            {year}年の写真 {view.count} 枚
          </Link>
        ) : (
          <span class={muted}>この年の写真はありません。</span>
        )}
      </p>
      <ol class="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {view.months.map((m) => (
          <li key={m.key} data-testid="calendar-month">
            <div class="mb-1 flex items-baseline justify-between px-0.5 text-sm">
              {m.count > 0 ? (
                <Link
                  prefetch="js"
                  key={m.key}
                  href={calendarHref(year, m.month)}
                  // On phones the days are too small to tap: the month
                  // (44px tall) is the way in.
                  class="inline-flex min-h-11 items-center font-semibold underline decoration-zinc-300 underline-offset-4 hover:decoration-current sm:min-h-0 dark:decoration-zinc-600"
                >
                  {m.month}月
                </Link>
              ) : (
                <span class={["font-semibold", muted]}>{m.month}月</span>
              )}
              {m.count > 0 && (
                <span class={["text-xs tabular-nums", muted]}>
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
                    <Link
                      prefetch="js"
                      key={cell.key}
                      href={mediaListHref({ date: cell.key })}
                      data-testid="calendar-heat-day"
                      data-date={cell.key}
                      aria-label={`${m.month}月${cell.day}日 ${cell.count}枚`}
                      title={`${m.month}月${cell.day}日 ${cell.count}枚`}
                      class={[
                        "block aspect-square rounded-sm hover:ring-2 hover:ring-sky-500 max-sm:pointer-events-none",
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
    </div>
  );
});
