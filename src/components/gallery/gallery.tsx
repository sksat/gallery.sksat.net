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
import {
  transformMediaInfo,
  type MediaWorld,
  type MediaInfo,
  type MediaInfoJSON,
  type MediaIndex,
} from "./types";

interface GalleryProps {
  selectedImageId: null | number;
  selectedWorld: null | "Real" | "VRChat";
}

interface GalleryState extends GalleryProps {
  mediaCount: number;
  filteredIndices: number[];
}

export default component$((props: GalleryProps) => {
  const indexResource = useResource$(() => {
    return fetch(import.meta.env.VITE_S3_BASE_URL + "/media.json")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch media.json: ${res.status}`);
        }
        return res.json();
      })
      .then((data: MediaInfoJSON[]) => data.map(transformMediaInfo))
      .catch((error) => {
        console.error("Failed to load media index:", error);
        return [] as MediaInfo[];
      });
  });

  const state = useStore<GalleryState>({
    selectedImageId: props.selectedImageId ?? null,
    selectedWorld: props.selectedWorld ?? "Real",
    mediaCount: 0,
    filteredIndices: [],
  });

  const worldArray: MediaWorld[] = ["Real", "VRChat"];

  const selectOption = $((event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      const value = event.target.value;
      if (worldArray.includes(value as MediaWorld)) {
        state.selectedWorld = value as MediaWorld;
        state.selectedImageId = null; // Reset selection when filter changes
      }
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
      if (
        state.selectedImageId === null ||
        state.filteredIndices.length === 0
      )
        return;

      const currentFilteredIndex = state.filteredIndices.indexOf(
        state.selectedImageId,
      );
      if (currentFilteredIndex === -1) return; // Selected image not in current filter

      if (event.key === "ArrowRight") {
        const nextFilteredIndex = currentFilteredIndex + 1;
        if (nextFilteredIndex < state.filteredIndices.length) {
          selectImage(state.filteredIndices[nextFilteredIndex]);
        }
      } else if (event.key === "ArrowLeft") {
        const prevFilteredIndex = currentFilteredIndex - 1;
        if (prevFilteredIndex >= 0) {
          selectImage(state.filteredIndices[prevFilteredIndex]);
        }
      }
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
            const filteredMedia = media
              .map((value, index) => ({ index, value }))
              .filter(
                (value) => value.value.world === state.selectedWorld,
              );

            state.mediaCount = media.length;
            state.filteredIndices = filteredMedia.map((m) => m.index);

            return (
              <div class="flex flex-wrap gap-4">
                {
                  // 選択した画像をオーバーレイ表示
                  state.selectedImageId !== null &&
                    media[state.selectedImageId] && (
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
                  filteredMedia.map((m) => (
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
