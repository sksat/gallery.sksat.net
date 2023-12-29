import {
  component$,
  useResource$,
  Resource,
  useSignal,
} from "@builder.io/qwik";

// media.json type
type MediaInfo = {
  number: number;
  file: string;
};

type MediaIndex = MediaInfo[];

function image(src: string) {
  return (
    <img
      alt="gallery"
      class="block h-full w-full rounded-lg object-cover object-center"
      src={src}
    />
  );
}

export default component$(() => {
  const indexResource = useResource$(() => {
    return fetch(import.meta.env.VITE_S3_BASE_URL + "/media/media.json")
      .then((res) => res.json())
      .then((data) => data);
  });

  const selectedImage = useSignal<string | null>(null);

  return (
    <div class="container mx-auto px-5 py-2 lg:px-32 lg:pt-12">
      <Resource
        value={indexResource}
        onResolved={(index: MediaIndex) => {
          return (
            <div class="-m-1 flex flex-wrap md:-m-2">
              {selectedImage.value && (
                <div
                  onClick$={() => (selectedImage.value = null)}
                  class="fixed inset-0 flex items-center justify-center bg-black"
                >
                  <img
                    src={selectedImage.value}
                    class="max-w-90% max-h-90%"
                  ></img>
                </div>
              )}
              {index.map((item) => (
                <div class="flex w-1/3 flex-wrap">
                  <div
                    class="w-full p-1 md:p-2"
                    onClick$={() => (selectedImage.value = item.file)}
                  >
                    {image(item.file)}
                  </div>
                </div>
              ))}
            </div>
          );
        }}
      />
    </div>
  );
});
