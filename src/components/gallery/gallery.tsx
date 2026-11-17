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
  dimensionsFromFile,
  GRID_CANDIDATES,
  imageUrl,
  srcSet,
} from "./images";
import { PhotoOverlay } from "./photo-overlay";
import {
  parseSort,
  SORT_LABELS,
  sortMedia,
  type SortKind,
  type SortOrder,
} from "./sort";
import {
  filterMediaByTags,
  parseTagFilter,
  tagCounts,
  toggleTag,
  type TagFilter,
  type TagMatchMode,
} from "./tags";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
// Image Worker base (workers/image); unset in dev/tests to use the originals.
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

interface GalleryState {
  selectedImageId: null | number;
  filter: TagFilter;
  sort: SortOrder;
  /** Every photo's index in display (sorted) order. */
  allIndices: number[];
  /** The filtered photos' indices in display order. */
  filteredIndices: number[];
}

const SORT_KINDS: SortKind[] = ["new", "old", "random"];

// A fresh seed for "random"; kept out of the pure sort code.
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const MODE_LABELS: Record<TagMatchMode, string> = {
  and: "すべて含む",
  or: "どれかを含む",
};

/**
 * Photo, filter and sort order as encoded in a URL. `?imageId=` is the old
 * share format and is still honoured on `/`.
 */
const stateFromUrl = (url: URL) => ({
  selectedImageId:
    photoIdFromPath(url.pathname) ??
    photoIdFromPath(`/photo/${url.searchParams.get("imageId")}`),
  filter: parseTagFilter(url.searchParams),
  sort: parseSort(url.searchParams),
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
    allIndices: [],
    filteredIndices: [],
  });

  // Filter and sort changes replace the history entry instead of pushing
  // one, so Back leaves the gallery rather than undoing each click.
  const setFilter = $((filter: TagFilter) => {
    state.filter = filter;
    window.history.replaceState(
      null,
      "",
      galleryUrl(state.selectedImageId, filter, state.sort),
    );
  });

  const setSort = $((sort: SortOrder) => {
    state.sort = sort;
    window.history.replaceState(
      null,
      "",
      galleryUrl(state.selectedImageId, state.filter, sort),
    );
  });

  const selectImage = $((imageId: null | number) => {
    if (imageId !== null && state.selectedImageId === null) {
      // Clicking an <img> does not move focus, so a chip or AND/OR radio
      // would keep it and react to Space/arrow keys behind the overlay.
      (document.activeElement as HTMLElement | null)?.blur();
    }
    state.selectedImageId = imageId;
    window.history.pushState(
      null,
      "",
      galleryUrl(imageId, state.filter, state.sort),
    );
  });

  // Arrow keys replace the entry, so one Back returns to the list.
  const stepImage = $((imageId: number) => {
    state.selectedImageId = imageId;
    window.history.replaceState(
      null,
      "",
      galleryUrl(imageId, state.filter, state.sort),
    );
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
        : state.allIndices;
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
      class="px-1 py-2 sm:px-2"
      window:onPopState$={onPopState}
      document:onKeyDown$={onKeyDown}
    >
      <Resource
        value={indexResource}
        onResolved={(media: MediaIndex) => {
          const allSorted = sortMedia(
            media.map((value, index) => ({ index, value })),
            state.sort,
          );
          const filteredMedia = sortMedia(
            filterMediaByTags(media, state.filter),
            state.sort,
          );
          const selectedTags = state.filter.tags;

          state.allIndices = allSorted.map((m) => m.index);
          state.filteredIndices = filteredMedia.map((m) => m.index);

          return (
            <>
              <div class="mb-3 flex flex-col gap-3 px-1">
                <div class="flex min-h-8 flex-wrap items-center gap-4 text-sm">
                  <span
                    data-testid="result-count"
                    aria-live="polite"
                    // Room for 3 digits, so the controls after it stay put.
                    class="min-w-[4.5em] tabular-nums"
                  >
                    {filteredMedia.length} 枚
                  </span>
                  <span class="flex items-center gap-1">
                    <select
                      data-testid="sort-select"
                      aria-label="並び順"
                      // Fixed width so the control doesn't resize with the
                      // selected label.
                      class="w-32 rounded border border-white/30 bg-transparent px-2 py-1 [&>option]:bg-[var(--color-bg)]"
                      onChange$={(_, el) => {
                        const kind = el.value as SortKind;
                        setSort({
                          kind,
                          seed: kind === "random" ? newSeed() : 0,
                        });
                      }}
                    >
                      {SORT_KINDS.map((kind) => (
                        <option
                          key={kind}
                          value={kind}
                          selected={state.sort.kind === kind}
                        >
                          {SORT_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                    {state.sort.kind === "random" && (
                      <button
                        type="button"
                        data-testid="reshuffle"
                        aria-label="再シャッフル"
                        title="再シャッフル"
                        class="rounded p-1 opacity-80 hover:opacity-100"
                        onClick$={() =>
                          setSort({ kind: "random", seed: newSeed() })
                        }
                      >
                        {/* Shuffle arrows */}
                        <svg
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M16 3h5v5" />
                          <path d="M4 20 21 3" />
                          <path d="M21 16v5h-5" />
                          <path d="m15 15 6 6" />
                          <path d="M4 4l5 5" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="タグで絞り込む"
                  class="flex flex-wrap items-center gap-2"
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
                  {selectedTags.length >= 2 && (
                    <fieldset class="ml-2 flex items-center gap-3 text-sm">
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
                      class="ml-2 text-sm underline opacity-80 hover:opacity-100"
                      onClick$={() =>
                        setFilter({ tags: [], mode: state.filter.mode })
                      }
                    >
                      クリア
                    </button>
                  )}
                </div>
              </div>
              {/*
                Justified rows: every tile has the row height and grows to
                fill the line; the image covers the tile, so it is cropped
                only by the few pixels the row was stretched. The trailing
                filler soaks up the last row so it is not stretched.
              */}
              <div data-testid="gallery-grid" class="flex flex-wrap gap-1">
                {
                  // 選択した画像をオーバーレイ表示
                  state.selectedImageId !== null &&
                    media[state.selectedImageId] && (
                      // Keyed by photo so stepping to the next one starts
                      // from its thumbnail with a fresh progress bar.
                      <PhotoOverlay
                        key={state.selectedImageId}
                        file={media[state.selectedImageId].file}
                        onClose$={() => selectImage(null)}
                      />
                    )
                }
                {
                  // 画像の一覧表示
                  filteredMedia.map((m) => (
                    <div
                      key={m.index}
                      // Row height steps with the width so a 16:9 photo
                      // sits about 2-3 per row and is cropped little.
                      class="group relative h-24 grow overflow-hidden sm:h-32 md:h-40 lg:h-48 xl:h-60"
                    >
                      <img
                        data-testid="gallery-image"
                        class="h-full w-auto min-w-full cursor-pointer object-cover align-bottom"
                        {...dimensionsFromFile(m.value.file)}
                        onClick$={() => selectImage(m.index)}
                        src={imageUrl(
                          S3_BASE,
                          m.value.file,
                          IMAGE_BASE,
                          "h240",
                        )}
                        srcset={srcSet(
                          S3_BASE,
                          m.value.file,
                          IMAGE_BASE,
                          GRID_CANDIDATES,
                        )}
                        loading="lazy"
                        decoding="async"
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
                <div aria-hidden="true" class="grow-[10]" />
              </div>
            </>
          );
        }}
      />
    </div>
  );
});
