import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";

export default component$(() => {
  return (
    <>
      <Gallery selectedWorld={null} selectedImageId={null} />
    </>
  );
});

export const head: DocumentHead = {
  title: "sksat gallery",
  meta: [
    {
      name: "description",
      content: "sksat gallery",
    },
  ],
};
