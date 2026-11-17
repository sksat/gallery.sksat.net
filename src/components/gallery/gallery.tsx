import {
  component$,
  useResource$,
  Resource,
  $,
  useStore,
} from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import {
  transformMediaInfo,
  type MediaInfo,
  type MediaInfoJSON,
  type MediaIndex,
} from "./types";
import { galleryUrl, navigateImage, photoIdFromPath } from "./logic";
import {
  filterMediaByTags,
  parseTagFilter,
  tagCounts,
  toggleTag,
  type TagFilter,
  type TagMatchMode,
} from "./tags";

interface GalleryState {
  selectedImageId: null | number;
  filter: TagFilter;
  mediaCount: number;
  filteredIndices: number[];
}

const MODE_LABELS: Record<TagMatchMode, string> = {
  and: "すべて含む",
  or: "どれかを含む",
};

/**
 * Photo and filter as encoded in a URL. `?imageId=` is the old share format
 * and is still honoured on `/`.
 */
const stateFromUrl = (url: URL) => ({
  selectedImageId:
    photoIdFromPath(url.pathname) ??
    photoIdFromPath(`/photo/${url.searchParams.get("imageId")}`),
  filter: parseTagFilter(url.searchParams),
});

export default component$(() => {
  const location = useLocation();
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
    ...stateFromUrl(location.url),
    mediaCount: 0,
    filteredIndices: [],
  });

  // Filter changes replace the history entry instead of pushing one, so Back
  // leaves the gallery rather than undoing each tag click.
  const setFilter = $((filter: TagFilter) => {
    state.filter = filter;
    window.history.replaceState(
      null,
      "",
      galleryUrl(state.selectedImageId, filter),
    );
  });

  const selectImage = $((imageId: null | number) => {
    if (imageId !== null && state.selectedImageId === null) {
      // Clicking an <img> does not move focus, so a chip or AND/OR radio
      // would keep it and react to Space/arrow keys behind the overlay.
      (document.activeElement as HTMLElement | null)?.blur();
    }
    state.selectedImageId = imageId;
    window.history.pushState(null, "", galleryUrl(imageId, state.filter));
  });

  // Arrow keys replace the entry, so one Back returns to the list.
  const stepImage = $((imageId: number) => {
    state.selectedImageId = imageId;
    window.history.replaceState(null, "", galleryUrl(imageId, state.filter));
  });

  // Back/Forward: restore the photo and filter from the URL we pushed.
  const onPopState = $(() => {
    Object.assign(state, stateFromUrl(new URL(window.location.href)));
  });

  const onKeyDown = $((event: KeyboardEvent) => {
    const current = state.selectedImageId;
    // Alt/Cmd+Arrow is the browser's Back/Forward; leave it alone.
    if (current === null || event.altKey || event.metaKey || event.ctrlKey)
      return;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // A photo opened from a URL may not match the filter; browse
      // everything then instead of leaving the arrows dead.
      const indices = state.filteredIndices.includes(current)
        ? state.filteredIndices
        : [...Array(state.mediaCount).keys()];
      const direction = event.key === "ArrowRight" ? "next" : "prev";
      const nextId = navigateImage(current, indices, direction);
      if (nextId !== null) {
        stepImage(nextId);
      }
    }
  });

  // Window/document listeners are bound to this root element rather than via
  // useOnWindow/useOnDocument: with those, Qwik 1.19 also copies the listeners
  // onto the first element created in a client re-render (the overlay), so
  // every keydown ran twice and ArrowRight skipped a photo.
  return (
    <div
      class="container mx-auto px-5 py-2 lg:px-32 lg:pt-12"
      window:onPopState$={onPopState}
      document:onKeyDown$={onKeyDown}
    >
      <Resource
        value={indexResource}
        onResolved={(media: MediaIndex) => {
          const filteredMedia = filterMediaByTags(media, state.filter);
          const selectedTags = state.filter.tags;

          state.mediaCount = media.length;
          state.filteredIndices = filteredMedia.map((m) => m.index);

          return (
            <>
              <div class="mb-6 flex flex-col gap-3">
                <div
                  role="group"
                  aria-label="タグで絞り込む"
                  class="flex flex-wrap gap-2"
                >
                  {tagCounts(media).map(({ tag, count }) => {
                    const pressed = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        data-testid="tag-chip"
                        aria-pressed={pressed}
                        onClick$={() =>
                          setFilter({
                            tags: toggleTag(state.filter.tags, tag),
                            mode: state.filter.mode,
                          })
                        }
                        class={[
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          pressed
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)]"
                            : "border-white/30 hover:border-white/70",
                        ]}
                      >
                        {tag}
                        <span class="ml-1.5 tabular-nums opacity-70">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div class="flex min-h-8 flex-wrap items-center gap-4 text-sm">
                  <span data-testid="result-count" aria-live="polite">
                    {filteredMedia.length} 枚
                  </span>
                  {selectedTags.length >= 2 && (
                    <fieldset class="flex items-center gap-3">
                      <legend class="sr-only">複数タグの条件</legend>
                      {(["and", "or"] as const).map((mode) => (
                        <label key={mode} class="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="tag-mode"
                            value={mode}
                            checked={state.filter.mode === mode}
                            onChange$={() =>
                              setFilter({ tags: state.filter.tags, mode })
                            }
                          />
                          {MODE_LABELS[mode]}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      class="underline opacity-80 hover:opacity-100"
                      onClick$={() =>
                        setFilter({ tags: [], mode: state.filter.mode })
                      }
                    >
                      クリア
                    </button>
                  )}
                </div>
              </div>
              <div class="flex flex-wrap gap-4">
                {
                  // 選択した画像をオーバーレイ表示
                  state.selectedImageId !== null &&
                    media[state.selectedImageId] && (
                      <div
                        data-testid="overlay"
                        onClick$={() => selectImage(null)}
                        class="bg-opacity-50 fixed inset-0 z-10 flex items-center justify-center bg-black"
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
                    <div key={m.index} class="group relative">
                      <img
                        data-testid="gallery-image"
                        class="max-h-60"
                        onClick$={() => selectImage(m.index)}
                        src={import.meta.env.VITE_S3_BASE_URL + m.value.file}
                      />
                      <div class="pointer-events-none absolute bottom-0 left-0 w-full bg-black/50 p-2.5 text-left text-white opacity-0 transition-opacity duration-500 group-hover:opacity-100">
                        <div>{m.value.timestamp?.toLocaleString("ja-JP")}</div>
                        {m.value.camera && (
                          <div>
                            {m.value.camera.make} {m.value.camera.model}
                          </div>
                        )}
                        <div class="flex gap-2">
                          {m.value.tags.map((tag) => (
                            <div key={tag}>{tag}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </>
          );
        }}
      />
    </div>
  );
});
