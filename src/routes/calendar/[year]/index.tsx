import { component$ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import { yearView, type YearView } from "@shared/calendar/calendar";
import {
  calendarHref,
  parseCalendarParams,
  publicCalendar,
} from "~/components/gallery/calendar";
import { YearCalendar } from "~/components/gallery/calendar-view";
import {
  calendarOgp,
  noindexIfEmpty,
  ogpHead,
  type Ogp,
} from "~/components/ogp";
import { useGalleryIndex } from "../../layout";

type Page = { view: YearView; ogp: Ogp };

/** /calendar/<year>/: the year at a glance. */
export const useYearPage = routeLoader$<Page>(async (event) => {
  const p = parseCalendarParams(event.params.year);
  if (!p) throw event.error(404, "Not found");
  const { media } = await event.resolveValue(useGalleryIndex);
  return {
    view: yearView(publicCalendar(media), p.year),
    ogp: calendarOgp(
      {
        s3Base: import.meta.env.VITE_S3_BASE_URL,
        imageBase: import.meta.env.VITE_IMAGE_BASE_URL,
      },
      media,
      `${p.year}年`,
      calendarHref(p.year),
    ),
  };
});

export default component$(() => {
  const page = useYearPage();
  return <YearCalendar view={page.value.view} />;
});

export const head: DocumentHead = ({ resolveValue }) => {
  const page = resolveValue(useYearPage);
  return noindexIfEmpty(ogpHead(page.ogp), page.view.count);
};
