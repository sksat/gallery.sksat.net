import {
  component$,
  useResource$,
  Resource,
  useSignal,
  useOnDocument,
  $,
  useStore,
} from "@builder.io/qwik";

import styles from "./gallery.module.css";

// media.json type
type MediaWorld = "VRChat" | "Real";
type MediaCamera = {
  make: string;
  model: string;
};

type MediaInfo = {
  file: string;
  world: MediaWorld;
  timestamp: null | Date;
  camera: null | MediaCamera;
  tags: [string];
};

type MediaIndex = MediaInfo[];

export default component$(() => {
  const indexResource = useResource$(() => {
    console.log(import.meta.env.VITE_S3_BASE_URL);
    return fetch(import.meta.env.VITE_S3_BASE_URL + "/media.json")
      .then((res) => res.json())
      .then((data) => data);
  });

  const selectedImage = useSignal<number>(-1);

  useOnDocument(
    "keydown",
    $((event: KeyboardEvent) => {
      if (selectedImage.value < 0) return; // 選択されていない
      if (event.key === "ArrowRight") {
        selectedImage.value += 0.5; // workaround for duplicated event
      } else if (event.key === "ArrowLeft") {
        selectedImage.value -= 0.5;
      }
    }),
  );

  const worldArray = ["Real", "VRChat"];

  const store = useStore({ selectedWorld: "Real" });

  const selectOption = $((event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      store.selectedWorld = event.target.value;
    }
  });

  return (
    <>
      <div class="container">
        <div class="items-center">
          {worldArray.map((worldOption) => (
            <div key={worldOption}>
              <input
                type="radio"
                class="h-4 w-4"
                id={worldOption}
                name="options"
                value={worldOption}
                onClick$={selectOption}
                checked={store.selectedWorld === worldOption}
              />
              <label for={worldOption} class="ml-2 text-lg">
                {worldOption}
              </label>
            </div>
          ))}
        </div>
      </div>
      <div class="container mx-auto px-5 py-2 lg:px-32 lg:pt-12">
        <Resource
          value={indexResource}
          onResolved={(media: MediaIndex) => {
            const filterdMedia = media.filter(
              (m) => m.world === store.selectedWorld,
            );
            console.log(selectedImage.value);
            return (
              <div class="flex flex-wrap gap-4">
                {
                  // 選択した画像をオーバーレイ表示
                  selectedImage.value >= 0 && (
                    <div
                      onClick$={() => (selectedImage.value = -1)}
                      class="fixed inset-0 z-10 flex items-center justify-center bg-black bg-opacity-50"
                    >
                      <img
                        src={
                          import.meta.env.VITE_S3_BASE_URL +
                          filterdMedia[Math.floor(selectedImage.value)].file
                        }
                        class="max-w-90% max-h-90%"
                      ></img>
                    </div>
                  )
                }
                {
                  // 画像の一覧表示
                  filterdMedia.map((item, index) => (
                    <div class={styles["image-container"]}>
                      <img
                        class="max-h-60"
                        onClick$={() => (selectedImage.value = index)}
                        src={import.meta.env.VITE_S3_BASE_URL + item.file}
                      />
                      <div class={styles["metadata"]}>
                        <div>{item.timestamp?.toLocaleString("ja-JP")}</div>
                        {item.camera && (
                          <div>
                            {item.camera.make} {item.camera.model}
                          </div>
                        )}
                        <div class="flex gap-2">
                          {item.tags.map((tag) => (
                            <div>{tag}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            );
          }}
        />
      </div>
    </>
  );
});
