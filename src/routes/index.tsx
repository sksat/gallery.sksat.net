import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";

import flexsearch from "flexsearch";
const { Index } = flexsearch;

const options = {};
const index = new Index(options);
index.add(0, "Jonn Doe");
index.add(1, "figa");

export default component$(() => {
  return (
    <>
      <Gallery />
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
