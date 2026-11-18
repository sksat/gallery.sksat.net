import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import {
  latestMonth,
  latestYear,
  monthView,
  yearView,
  type MonthView,
  type YearView,
} from "@shared/calendar/calendar";
import {
  AdminMonthCalendar,
  AdminYearCalendar,
} from "~/components/calendar-view";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import {
  loadCalendar,
  parseCalendarParams,
  type CalendarCover,
} from "~/lib/calendar";
import { getDB, getImageBase } from "~/lib/env";

type CalendarPage =
  | {
      kind: "ok";
      month: MonthView<CalendarCover> | null;
      year: YearView | null;
      imageBase: string | null;
    }
  | { kind: "missing-binding" };

/**
 * /calendar/ (the newest month with photos), /calendar/<yyyy>/ (the year)
 * and /calendar/<yyyy>/<mm>/ (a month): every listed photo, private ones
 * too.
 */
export const useCalendarPage = routeLoader$<CalendarPage>(
  async ({ platform, params, status, error }) => {
    const parts = params.date.split("/").filter(Boolean);
    const at =
      parts.length === 0
        ? null
        : parts.length <= 2
          ? parseCalendarParams(parts[0], parts[1])
          : null;
    if (parts.length > 0 && at === null) throw error(404, "Not found");
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/calendar loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    const index = await loadCalendar(db);
    const imageBase = getImageBase(platform);
    if (at?.month !== undefined) {
      return {
        kind: "ok",
        month: monthView(index, at.year, at.month),
        year: null,
        imageBase,
      };
    }
    if (at) {
      return {
        kind: "ok",
        month: null,
        year: yearView(index, at.year),
        imageBase,
      };
    }
    const latest = latestMonth(index);
    const year = latestYear(index);
    return {
      kind: "ok",
      month: latest && monthView(index, latest.year, latest.month),
      year: latest === null && year !== null ? yearView(index, year) : null,
      imageBase,
    };
  },
);

export default component$(() => {
  const data = useCalendarPage();
  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { month, year, imageBase } = data.value;
  if (month) return <AdminMonthCalendar view={month} imageBase={imageBase} />;
  if (year) return <AdminYearCalendar view={year} />;
  return (
    <StatePanel tone="empty" level={1} title="No dated photos yet">
      <p>Photos appear here once they have a taken-at time.</p>
    </StatePanel>
  );
});

export const head: DocumentHead = { title: "Calendar — Admin" };
