import { component$, $, useComputed$, useStore } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { useGalleryIndex } from "~/routes/layout";
import {
  transformMediaInfo,
  type CameraJSON,
  type MediaInfoJSON,
} from "./types";
import {
  galleryUrl,
  navigateImage,
  photoIdFromPath,
  visibleMedia,
} from "./logic";
import {
  cameraHref,
  cameraLabel,
  cameraSlug,
  cameraSlugFromPath,
  findCamera,
} from "./cameras";
import { CameraHeader } from "./camera-header";
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
  /** Public id of the open photo. */
  selectedImageId: null | string;
  filter: TagFilter;
  sort: SortOrder;
  /** Camera slug on a camera page, else null. */
  camera: null | string;
}

type GalleryProps = {
  /**
   * The photo of a /photo/<id> page, from its route. An unlisted photo is
   * not in the list, so the overlay takes it from here; it never joins the
   * grid, the tag counts or the arrow-key order.
   */
  photo?: MediaInfoJSON;
  /** The camera of a /camera/<slug>/ page, from its route. */
  camera?: CameraJSON;
};

const SORT_KINDS: SortKind[] = ["new", "old", "random"];

// A fresh seed for "random"; kept out of the pure sort code.
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const MODE_LABELS: Record<TagMatchMode, string> = {
  and: "すべて含む",
  or: "どれかを含む",
};

/**
 * Photo, filter, sort order and camera as encoded in a URL. The camera comes from a `/camera/<slug>/` path, or `?camera=` on a photo
 * opened from one.
 */
const stateFromUrl = (url: URL) => ({
  selectedImageId: photoIdFromPath(url.pathname),
  filter: parseTagFilter(url.searchParams),
  sort: parseSort(url.searchParams),
  camera:
    cameraSlugFromPath(url.pathname) ??
    (url.searchParams.get("camera") || null),
});

export default component$<GalleryProps>((props) => {
  const location = useLocation();
  // Loaded by the layout for every page (public photos and cameras only).
  const index = useGalleryIndex();
  const state = useStore<GalleryState>(stateFromUrl(location.url));

  // What to show for the current URL state.
  const view = useComputed$(() => {
    const media = index.value.media.map(transformMediaInfo);
    // The open photo: from the list, else (unlisted) from the route.
    const selected =
      state.selectedImageId === null
        ? undefined
        : (media.find((m) => m.id === state.selectedImageId) ??
          (props.photo?.id === state.selectedImageId
            ? transformMediaInfo(props.photo)
            : undefined));
    // An unknown `?camera=` on a photo link is ignored (an unknown
    // /camera/<slug>/ is already a 404 from its route loader).
    const cameraInfo =
      state.camera === null
        ? null
        : props.camera?.slug === state.camera
          ? props.camera
          : findCamera(index.value.cameras, media, state.camera);
    const camera = cameraInfo === null ? null : state.camera;
    // On a camera page, "every photo" means every photo taken with that
    // camera: the tag counts and the arrow-key fallback use it.
    const scope = visibleMedia(
      media,
      { tags: [], mode: state.filter.mode },
      camera,
    );
    const filteredMedia = sortMedia(
      visibleMedia(media, state.filter, camera),
      state.sort,
    );
    return {
      selected,
      cameraInfo,
      camera,
      scope,
      filteredMedia,
      /** Every listed photo's id in display order (arrow-key fallback). */
      allIds: sortMedia(scope, state.sort).map((m) => m.value.id),
      /** The filtered photos' ids in display order. */
      filteredIds: filteredMedia.map((m) => m.value.id),
    };
  });

  // Filter and sort changes replace the history entry instead of pushing
  // one, so Back leaves the gallery rather than undoing each click.
  const setFilter = $((filter: TagFilter) => {
    state.filter = filter;
    window.history.replaceState(
      null,
      "",
      galleryUrl(state.selectedImageId, filter, state.sort, state.camera),
    );
  });

  const setSort = $((sort: SortOrder) => {
    state.sort = sort;
    window.history.replaceState(
      null,
      "",
      galleryUrl(state.selectedImageId, state.filter, sort, state.camera),
    );
  });

  const selectImage = $((imageId: null | string) => {
    if (imageId !== null && state.selectedImageId === null) {
      // Clicking an <img> does not move focus, so a chip or AND/OR radio
      // would keep it and react to Space/arrow keys behind the overlay.
      (document.activeElement as HTMLElement | null)?.blur();
    }
    state.selectedImageId = imageId;
    window.history.pushState(
      null,
      "",
      galleryUrl(imageId, state.filter, state.sort, state.camera),
    );
  });

  // Arrow keys replace the entry, so one Back returns to the list.
  const stepImage = $((imageId: string) => {
    state.selectedImageId = imageId;
    window.history.replaceState(
      null,
      "",
      galleryUrl(imageId, state.filter, state.sort, state.camera),
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
    // Arrows in a text field (the share URL) move the caret. Checked here
    // because qwikloader runs document listeners before stoppropagation.
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === "text"
    )
      return;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // A photo opened from a URL may not match the filter; browse
      // everything then instead of leaving the arrows dead. An unlisted
      // photo is in neither list, so the arrows do nothing on it.
      const { allIds, filteredIds } = view.value;
      const indices = filteredIds.includes(current) ? filteredIds : allIds;
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
      {(() => {
        const { selected, cameraInfo, camera, scope, filteredMedia } =
          view.value;
        const selectedTags = state.filter.tags;

        return (
          <>
            {camera !== null && (
              <CameraHeader
                slug={camera}
                camera={cameraInfo}
                count={scope.length}
              />
            )}
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
                {tagCounts(scope.map((m) => m.value)).map(({ tag, count }) => {
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
                selected && (
                  // Keyed by photo so stepping to the next one starts
                  // from its thumbnail with a fresh progress bar.
                  <PhotoOverlay
                    key={selected.id}
                    src={{ id: selected.id, file: selected.file }}
                    onClose$={() => selectImage(null)}
                  />
                )
              }
              {
                // 画像の一覧表示
                filteredMedia.map((m) => (
                  <div
                    key={m.value.id}
                    data-testid="gallery-tile"
                    // Row height steps with the width so a 16:9 photo
                    // sits about 2-3 per row and is cropped little.
                    class="group relative h-24 grow overflow-hidden sm:h-32 md:h-40 lg:h-48 xl:h-60"
                  >
                    <img
                      data-testid="gallery-image"
                      class="h-full w-auto min-w-full cursor-pointer object-cover align-bottom"
                      {...dimensionsFromFile(m.value.file)}
                      onClick$={() => selectImage(m.value.id)}
                      src={imageUrl(S3_BASE, m.value, IMAGE_BASE, "h240")}
                      srcset={srcSet(
                        S3_BASE,
                        m.value,
                        IMAGE_BASE,
                        GRID_CANDIDATES,
                      )}
                      loading="lazy"
                      decoding="async"
                    />
                    <div class="pointer-events-none absolute bottom-0 left-0 w-full bg-black/50 p-2.5 text-left text-white opacity-0 transition-opacity duration-500 group-focus-within:opacity-100 group-hover:opacity-100">
                      <div>{m.value.takenText}</div>
                      {!m.value.camera && m.value.maker && (
                        <div>{m.value.maker}</div>
                      )}
                      {m.value.camera && (
                        <div>
                          {/*
                              Clickable only while the caption shows, so a
                              click on an unhovered tile still opens the
                              photo. Plain <a>: see layout/header.tsx.
                            */}
                          <a
                            data-testid="camera-link"
                            href={cameraHref(cameraSlug(m.value.camera))}
                            class="pointer-events-none text-white underline decoration-white/50 underline-offset-2 group-focus-within:pointer-events-auto group-hover:pointer-events-auto hover:decoration-white"
                          >
                            {cameraLabel(m.value.camera)}
                          </a>
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
      })()}
    </div>
  );
});
