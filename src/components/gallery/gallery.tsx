import {
  component$,
  useResource$,
  Resource,
  useSignal,
  useOnDocument,
  $,
} from "@builder.io/qwik";

// media.json type
type MediaInfo = {
  number: number;
  file: string;
};

type MediaIndex = MediaInfo[];

export default component$(() => {
  const indexResource = useResource$(() => {
    return fetch(import.meta.env.VITE_S3_BASE_URL + "/media/media.json")
      .then((res) => res.json())
      .then((data) => data);
  });

  const selectedImage = useSignal<number>(-1);

  useOnDocument(
    "keydown",
    $((event: KeyboardEvent) => {
      if (selectedImage.value < 0) return; // 選択されていない
      if (event.key === "ArrowRight") {
        selectedImage.value++;
      } else if (event.key === "ArrowLeft") {
        selectedImage.value--;
      }
    }),
  );

  return (
    <div class="container mx-auto px-5 py-2 lg:px-32 lg:pt-12">
      <Resource
        value={indexResource}
        onResolved={(media: MediaIndex) => {
          return (
            <div class="-m-1 flex flex-wrap md:-m-2">
              {
                // 選択した画像をオーバーレイ表示
                selectedImage.value >= 0 && (
                  <div
                    onClick$={() => (selectedImage.value = -1)}
                    class="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50"
                  >
                    <img
                      src={media[selectedImage.value].file}
                      class="max-w-90% max-h-90%"
                    ></img>
                  </div>
                )
              }
              {
                // 画像の一覧表示
                media.map((item, i) => (
                  <div class="flex w-1/3 flex-wrap">
                    <div
                      class="w-full p-1 md:p-2"
                      onClick$={() => (selectedImage.value = i)}
                    >
                      <img
                        class="block h-full w-full rounded-lg object-cover object-center"
                        src={item.file}
                      />
                    </div>
                  </div>
                ))
              }
            </div>
          );
        }}
      />
    </div>
  );
});
