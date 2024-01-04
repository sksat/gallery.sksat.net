import { component$ } from "@builder.io/qwik";
import { useLocation, routeLoader$ } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";

import Gallery from "~/components/gallery/gallery";

export default component$(() => {
  const location = useLocation();
  const imageId = location.params.imageId;

  return (
    <>
      <Gallery selectedWorld={null} selectedImageId={parseInt(imageId, 10)} />
    </>
  );
});

export const head: DocumentHead = ({ resolveValue }) => {
  const imageUrl = resolveValue(useFetchImageUrl) as unknown as string;

  return {
    title: "sksat gallery",
    meta: [
      {
        name: "description",
        content: "sksat gallery",
      },
      { property: "og:image", content: imageUrl },
    ],
  };
};

export const useFetchImageUrl = routeLoader$(async (event) => {
  const imageId = parseInt(event.params.imageId, 10);
  const response = await fetch(import.meta.env.VITE_S3_BASE_URL + "/media.json");
  const media = await response.json();
  return import.meta.env.VITE_S3_BASE_URL + media[imageId].file;
});