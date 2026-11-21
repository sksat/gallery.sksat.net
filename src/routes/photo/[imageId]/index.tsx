import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";
import { photoHead, usePhotoPage } from "./layout";

// The photo's URL: the list carried in its query (the whole gallery
// without one) with the photo open over it, as a click on its tile shows.
// The gallery reads the list and the photo from the URL itself; the photo
// is passed in for an unlisted one, which is in no list.
export default component$(() => {
  const page = usePhotoPage();
  return <Gallery photo={page.value.photo} />;
});

export const head: DocumentHead = photoHead;
