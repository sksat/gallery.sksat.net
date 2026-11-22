import { component$ } from "@builder.io/qwik";

import {
  WEEKDAYS,
  monthWeeks,
  parseDateKey,
  takenDateKey,
  type Precision,
} from "@shared/calendar/calendar";

import { calendarHref, dateGalleryHref } from "./calendar";

/**
 * A small calendar for a photo's page: the month it was taken, with its
 * day marked (a link to that day's photos) and the month's name linking
 * to the month in /calendar/. A photo known only to the month shows the
 * month unmarked; one known only to the year just links to the year.
 * Renders nothing when the date is hidden.
 *
 * `timestamp` and `precision` are the API's `timestamp` and
 * `timestamp_precision` for the photo. Pass `linkDay={false}` for an
 * unlisted photo: it is in no list, so its day's gallery would not have it.
 */
export const MiniCalendar = component$<{
  timestamp: string | null;
  precision?: Precision | null;
  linkDay?: boolean;
}>(({ timestamp, precision, linkDay = true }) => {
  // The photo's day: a filled circle in the accent colour.
  const dayClass =
    "mx-auto grid size-7 place-items-center rounded-full bg-[var(--color-accent)] font-semibold text-[var(--color-bg)]";
  // A card like the camera's and the map's on the photo page.
  const card = "rounded-2xl bg-white/[0.04] ring-1 ring-white/10 ring-inset";
  const key = takenDateKey(timestamp, precision);
  const p = parseDateKey(key);
  if (!p || key === null) return null;
  // Plain <a>s: see the note in components/layout/header.tsx.
  if (p.month === undefined) {
    return (
      <a
        href={calendarHref(p.year)}
        data-testid="mini-calendar"
        class={[
          "block px-4 py-3 text-sm !text-white hover:bg-white/[0.08]",
          card,
        ]}
      >
        {p.year}年のカレンダー
      </a>
    );
  }
  const { year, month, day } = p;
  return (
    <figure data-testid="mini-calendar" class={["p-4 text-[0.8125rem]", card]}>
      <figcaption class="mb-2 text-[0.9375rem] font-semibold">
        <a
          href={calendarHref(year, month)}
          style={{ color: "inherit" }}
          class="underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          {year}年{month}月
        </a>
      </figcaption>
      <div class="grid grid-cols-7 gap-y-0.5 text-center leading-7 tabular-nums">
        {WEEKDAYS.map((d) => (
          <span key={d} aria-hidden="true" class="text-xs text-white/45">
            {d}
          </span>
        ))}
        {monthWeeks(year, month)
          .flat()
          .map((d, i) =>
            d === null ? (
              <span key={`x${i}`} aria-hidden="true" />
            ) : d === day ? (
              linkDay ? (
                <a
                  key={d}
                  href={dateGalleryHref(key)}
                  aria-label={`${month}月${d}日の写真`}
                  class={dayClass}
                  style={{ color: "var(--color-bg)" }}
                >
                  {d}
                </a>
              ) : (
                <span key={d} class={dayClass}>
                  <span class="sr-only">{month}月</span>
                  {d}
                  <span class="sr-only">日</span>
                </span>
              )
            ) : (
              <span key={d} aria-hidden="true" class="text-white/55">
                {d}
              </span>
            ),
          )}
      </div>
    </figure>
  );
});
