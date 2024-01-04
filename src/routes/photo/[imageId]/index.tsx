import { component$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

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
