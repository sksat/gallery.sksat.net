import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

import { PhotoDetail } from "~/components/gallery/photo-detail";
import { photoHead, usePhotoPage } from "../layout";

// The photo's detail page; the list it was opened from (tags, sort,
// camera, date) is read from the query.
export default component$(() => {
  const page = usePhotoPage();
  return <PhotoDetail photo={page.value.photo} />;
});

export const head: DocumentHead = photoHead;
