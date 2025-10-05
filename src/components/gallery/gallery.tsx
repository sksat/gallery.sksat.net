import {
  component$,
  useResource$,
  useTask$,
  Resource,
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
  tags: string[];
};

type MediaIndex = MediaInfo[];

interface GalleryState {
  selectedImageId: null | number;
  selectedWorld: null | "Real" | "VRChat";
}

export default component$((props: GalleryState) => {
  const indexResource = useResource$(() => {
    console.log(import.meta.env.VITE_S3_BASE_URL);
    return fetch(import.meta.env.VITE_S3_BASE_URL + "/media.json")
      .then((res) => res.json())
      .then((data: MediaInfo[]) =>
        data.map((item) => ({
          ...item,
          timestamp: item.timestamp ? new Date(item.timestamp as any) : null,
        }))
      );
  });

  const state = useStore<GalleryState>({
    selectedImageId: props.selectedImageId ?? null,
    selectedWorld: "Real",
  });

  const worldArray = ["Real", "VRChat"];

  const selectOption = $((event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      state.selectedWorld = event.target.value as MediaWorld;
    }
  });

  const selectImage = $((imageId: null | number) => {
    state.selectedImageId = imageId;
    if (imageId !== null) {
      window.history.pushState(null, "", `/photo/${imageId}`);
    } else {
      window.history.pushState(null, "", "/");
    }
  });

  useOnDocument(
    "keydown",
    $((event: KeyboardEvent) => {
      if (state.selectedImageId === null) return; // 選択されていない
      if (event.key === "ArrowRight") {
        console.log(event);
        console.log(state.selectedImageId);
        state.selectedImageId++;
        console.log(state.selectedImageId);
      } else if (event.key === "ArrowLeft") {
        state.selectedImageId--;
      }

      selectImage(state.selectedImageId);
    }),
  );

  useTask$(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const imageId = url.searchParams.get("imageId");

      if (imageId) {
        state.selectedImageId = parseInt(imageId, 10);
      }
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
                checked={state.selectedWorld === worldOption}
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
            const filterdMedia = media
              .map((value, index) => ({ index, value }))
              .filter(
                (value) =>
                  value.value.world === (state.selectedWorld as string),
              );
            return (
              <div class="flex flex-wrap gap-4">
                {
                  // 選択した画像をオーバーレイ表示
                  state.selectedImageId !== null && (
                    <div
                      onClick$={() => selectImage(null)}
                      class="fixed inset-0 z-10 flex items-center justify-center bg-black bg-opacity-50"
                    >
                      <img
                        src={
                          import.meta.env.VITE_S3_BASE_URL +
                          media[state.selectedImageId].file
                        }
                        class="max-w-90% max-h-90%"
                      ></img>
                    </div>
                  )
                }
                {
                  // 画像の一覧表示
                  filterdMedia.map((m) => (
                    <div class={styles["image-container"]}>
                      <img
                        class="max-h-60"
                        onClick$={() => selectImage(m.index)}
                        src={import.meta.env.VITE_S3_BASE_URL + m.value.file}
                      />
                      <div class={styles["metadata"]}>
                        <div>{m.value.timestamp?.toLocaleString("ja-JP")}</div>
                        {m.value.camera && (
                          <div>
                            {m.value.camera.make} {m.value.camera.model}
                          </div>
                        )}
                        <div class="flex gap-2">
                          {m.value.tags.map((tag) => (
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
