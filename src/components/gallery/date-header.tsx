import { component$ } from "@builder.io/qwik";

import { formatDateKey } from "@shared/calendar/calendar";

import { SiteNav } from "../layout/site-nav";
import { CALENDAR_HREF, calendarHrefFor } from "./calendar";

/**
 * Above the gallery when it shows one date from the calendar (`?date=`):
 * the date, and the way back to its calendar month.
 */
export const DateHeader = component$<{ date: string }>(({ date }) => (
  <div class="mb-4 px-1">
    <div class="flex flex-wrap items-center gap-x-3">
      {/* Plain <a>s: see the note in components/layout/header.tsx. */}
      <nav aria-label="戻る" class="flex gap-4 text-sm">
        <a
          href={calendarHrefFor(date)}
          class="inline-flex min-h-11 items-center opacity-80 hover:opacity-100 sm:min-h-8"
        >
          ← カレンダー
        </a>
        <a
          href="/"
          class="inline-flex min-h-11 items-center opacity-80 hover:opacity-100 sm:min-h-8"
        >
          すべての写真
        </a>
      </nav>
      {/* A date's photos belong to the calendar: no second link to it. */}
      <SiteNav section={CALENDAR_HREF} />
    </div>
    <h1
      data-testid="date-heading"
      class="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
    >
      {formatDateKey(date)}
    </h1>
  </div>
));
