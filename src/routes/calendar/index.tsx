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
import { CALENDAR_HREF, publicCalendar } from "~/components/gallery/calendar";
import {
  EmptyCalendar,
  MonthCalendar,
  YearCalendar,
} from "~/components/gallery/calendar-view";
import type { ImageSource } from "~/components/gallery/images";
import { calendarOgp, ogpHead, type Ogp } from "~/components/ogp";
import { useGalleryIndex } from "../layout";

type Page = {
  month: MonthView<ImageSource> | null;
  /** When no photo is dated to a month: the newest year. */
  year: YearView | null;
  ogp: Ogp;
};

/** /calendar/: the newest month with photos (else the newest year). */
export const useCalendarPage = routeLoader$<Page>(async (event) => {
  const { media } = await event.resolveValue(useGalleryIndex);
  const index = publicCalendar(media);
  const month = latestMonth(index);
  const year = month ? null : latestYear(index);
  return {
    month: month && monthView(index, month.year, month.month),
    year: year === null ? null : yearView(index, year),
    ogp: calendarOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
      media,
      null,
      CALENDAR_HREF,
    ),
  };
});

export default component$(() => {
  const page = useCalendarPage();
  const { month, year } = page.value;
  return month ? (
    <MonthCalendar view={month} />
  ) : year ? (
    <YearCalendar view={year} />
  ) : (
    <EmptyCalendar />
  );
});

export const head: DocumentHead = ({ resolveValue }) =>
  ogpHead(resolveValue(useCalendarPage).ogp);
