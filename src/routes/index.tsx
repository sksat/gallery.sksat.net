import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";

// The gallery reads the photo and tag filter from the URL itself.
export default component$(() => <Gallery />);

export const head: DocumentHead = {
  title: "sksat gallery",
  meta: [
    {
      name: "description",
      content: "sksat gallery",
    },
  ],
};
