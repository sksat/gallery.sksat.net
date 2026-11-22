import {
  component$,
  $,
  useComputed$,
  useContextProvider,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { CAMERA_PREVIEWS } from "./camera-link";
import { useGalleryIndex } from "~/routes/layout";
import {
  transformMediaInfo,
  type CameraJSON,
  type MediaInfoJSON,
} from "./types";
import {
  galleryStateFromUrl,
  galleryUrl,
  neighborIds,
  photoDetailUrl,
  photoUrl,
  visibleMedia,
  type GalleryUrlState,
} from "./logic";
import { DateHeader } from "./date-header";
import { SiteNav } from "../layout/site-nav";
import {
  cameraHref,
  cameraLabel,
  cameraPreviews,
  cameraSlug,
  digitizedWith,
  findCamera,
} from "./cameras";
import { DigitizedList } from "./digitized-list";
import { CameraHeader } from "./camera-header";
import { GRID_CANDIDATES, imageUrl, photoSize, srcSet } from "./images";
import {
  aspectOf,
  FILLER_GROW,
  hasKnownSize,
  tileAspect,
  tileStyle,
} from "./tile";
import { PhotoOverlay } from "./photo-overlay";
import { OPEN_PREVIEW } from "./hover-card";
import { SORT_LABELS, sortMedia, type SortKind, type SortOrder } from "./sort";
import {
  DEFAULT_TAG_MODE,
  mediaTags,
  tagCounts,
  toggleTag,
  type TagFilter,
  type TagMatchMode,
} from "./tags";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
// Image Worker base (workers/image); unset in dev/tests to use the originals.
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

type GalleryState = GalleryUrlState;

type GalleryProps = {
  /** The camera of a /camera/<slug>/ page, from its route. */
  camera?: CameraJSON;
  /**
   * The photo of a /photo/<id>/ page, from its route: what the overlay
   * shows for it when it is in no list (unlisted).
   */
  photo?: MediaInfoJSON;
};

const SORT_KINDS: SortKind[] = ["new", "old", "random"];

/** The filter a tag in the info panel sets: that tag alone. */
const tagOnly = (tag: string): TagFilter => ({
  tags: [tag],
  mode: DEFAULT_TAG_MODE,
});

// A fresh seed for "random"; kept out of the pure sort code.
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const MODE_LABELS: Record<TagMatchMode, string> = {
  and: "すべて含む",
  or: "どれかを含む",
};

/**
 * Marks the history entries the overlay pushed (`history.state`), so
 * closing it goes back to the list entry under it.
 */
const OVERLAY_ENTRY = "galleryOverlay";

/**
 * The list's URL (`/` or `/camera/<slug>/` with its query). `camera` is
 * the list's known camera: an unknown `?camera=` of a photo URL is dropped
 * rather than turned into a 404 page.
 */
const listUrl = (s: GalleryState, camera: string | null) =>
  galleryUrl(s.filter, s.sort, camera, s.date);

/**
 * The URL of a photo open over the list: the photo's URL with the list in
 * its query, so a reload or a shared link opens the same, and Cloudflare
 * Web Analytics (which records the path, not the query) counts the view.
 */
const overlayUrl = (s: GalleryState, imageId: string) =>
  photoUrl(imageId, s.filter, s.sort, s.camera, s.date);

const isOverlayEntry = () =>
  (window.history.state as Record<string, unknown> | null)?.[OVERLAY_ENTRY] ===
  true;

/** Keys that act on the focused control rather than on the photo. */
const isControl = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  t.closest("a, button, input, select, textarea, [contenteditable]") !== null;

export default component$<GalleryProps>((props) => {
  const location = useLocation();
  // Loaded by the layout for every page (public photos and cameras only).
  const index = useGalleryIndex();
  // The overlay's camera links preview their camera (camera-link.tsx).
  const cameraCards = useComputed$(() =>
    cameraPreviews(
      index.value.media.map(transformMediaInfo),
      index.value.cameras,
    ),
  );
  useContextProvider(CAMERA_PREVIEWS, cameraCards);
  const state = useStore<GalleryState>(galleryStateFromUrl(location.url));
  // Aspect ratios of loaded photos whose size the API did not give.
  const natural = useStore<Record<string, number>>({});
  const grid = useSignal<HTMLElement>();
  // Photos of unknown size that loaded before the page resumed (cached
  // ones) fired their load event before anything could hear it.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    for (const img of grid.value?.querySelectorAll<HTMLImageElement>(
      "img[data-unsized]",
    ) ?? []) {
      const a = img.complete
        ? aspectOf(img.naturalWidth, img.naturalHeight)
        : null;
      const id = img.dataset.unsized;
      if (a !== null && id) natural[id] = a;
    }
  });

  // What to show for the current URL state.
  const view = useComputed$(() => {
    const media = index.value.media.map(transformMediaInfo);
    // The open photo: from the list, or the photo of this /photo/<id>/ page
    // when it is in none (unlisted: open over the list it is not in, with
    // no previous / next). Any other photo not in the list is not opened.
    const selected =
      state.selectedImageId === null
        ? undefined
        : (media.find((m) => m.id === state.selectedImageId) ??
          (props.photo?.id === state.selectedImageId
            ? transformMediaInfo(props.photo)
            : undefined));
    // An unknown /camera/<slug>/ is already a 404 from its route loader.
    const cameraInfo =
      state.camera === null
        ? null
        : props.camera?.slug === state.camera
          ? props.camera
          : findCamera(index.value.cameras, media, state.camera);
    const camera = cameraInfo === null ? null : state.camera;
    // On a camera page, "every photo" means every photo taken with that
    // camera (and on a calendar date, then): the tag counts and the
    // arrow-key fallback use it.
    const scope = visibleMedia(
      media,
      { tags: [], mode: state.filter.mode },
      camera,
      state.date,
    );
    const filteredMedia = sortMedia(
      visibleMedia(media, state.filter, camera, state.date),
      state.sort,
    );
    // Every listed photo's id in display order (the arrows' fallback): the
    // date's when the photo is on it, else the whole camera or gallery.
    const allIds = sortMedia(
      selected && scope.some((m) => m.value.id === selected.id)
        ? scope
        : visibleMedia(media, { tags: [], mode: state.filter.mode }, camera),
      state.sort,
    ).map((m) => m.value.id);
    const filteredIds = filteredMedia.map((m) => m.value.id);
    const around =
      state.selectedImageId === null
        ? { prev: null, next: null }
        : neighborIds(state.selectedImageId, filteredIds, allIds);
    return {
      selected,
      cameraInfo,
      camera,
      scope,
      filteredMedia,
      /** Every listed photo's id in display order (arrow-key fallback). */
      allIds,
      /** The filtered photos' ids in display order. */
      filteredIds,
      /** On a camera's list, the photos digitised with it. */
      digitized: camera === null ? [] : digitizedWith(media, camera),
      /** Whether the open photo has one before / after it (swipes). */
      neighbors: {
        prev: around.prev !== null,
        next: around.next !== null,
      },
    };
  });

  // Filter and sort changes replace the history entry instead of pushing
  // one, so Back leaves the gallery rather than undoing each click. They
  // are behind the overlay, so the list is what is shown.
  const setFilter = $((filter: TagFilter) => {
    state.filter = filter;
    window.history.replaceState(null, "", listUrl(state, view.value.camera));
  });

  const setSort = $((sort: SortOrder) => {
    state.sort = sort;
    window.history.replaceState(null, "", listUrl(state, view.value.camera));
  });

  // Opening a photo pushes its URL over the list's.
  const openImage = $((imageId: string) => {
    if (state.selectedImageId === null) {
      // Clicking an <img> does not move focus, so a chip or AND/OR radio
      // would keep it and react to Space/arrow keys behind the overlay.
      (document.activeElement as HTMLElement | null)?.blur();
    }
    state.selectedImageId = imageId;
    window.history.pushState(
      { [OVERLAY_ENTRY]: true },
      "",
      overlayUrl(state, imageId),
    );
  });

  // Closing returns to the list entry the overlay was pushed over, so
  // Forward reopens the photo and Back leaves the list. A photo URL that
  // was loaded as it is (a shared link, a reload) has no list entry under
  // it: it is replaced by the list instead.
  const closeImage = $(() => {
    // Already closed (a second click before the overlay went away).
    if (state.selectedImageId === null) return;
    state.selectedImageId = null;
    if (isOverlayEntry()) window.history.back();
    else
      window.history.replaceState(null, "", listUrl(state, view.value.camera));
  });

  // A tag in the info panel: close the photo and show the photos with
  // that tag, as a new history entry (Back returns to the photo).
  const filterByTag = $((tag: string) => {
    const filter = tagOnly(tag);
    // An unknown `?camera=` is dropped rather than turned into a 404 page.
    const camera = view.value.camera;
    state.filter = filter;
    state.selectedImageId = null;
    state.camera = camera;
    window.history.pushState(null, "", galleryUrl(filter, state.sort, camera));
  });

  // Arrow keys replace the entry, so one Back returns to the list. It
  // keeps its mark: a photo URL loaded as it is has no list entry under
  // it to go back to.
  const stepImage = $((imageId: string) => {
    state.selectedImageId = imageId;
    window.history.replaceState(
      window.history.state,
      "",
      overlayUrl(state, imageId),
    );
  });

  // Back/Forward: restore the photo and filter from the URL we pushed.
  const onPopState = $(() => {
    Object.assign(state, galleryStateFromUrl(new URL(window.location.href)));
  });

  // ←/→ and swipes. A photo opened from a URL may not match the filter;
  // browse everything then instead of leaving them dead. An unlisted photo
  // is in neither list, so they do nothing on it.
  const step = $((direction: "prev" | "next") => {
    const current = state.selectedImageId;
    if (current === null) return;
    const { allIds, filteredIds } = view.value;
    const nextId = neighborIds(current, filteredIds, allIds)[direction];
    if (nextId !== null) stepImage(nextId);
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
      step(event.key === "ArrowRight" ? "next" : "prev");
    } else if (event.key === "Escape" && !event.isComposing) {
      // An open preview card takes this Esc (hover-card.tsx).
      if (!document.querySelector(`[${OPEN_PREVIEW}]`)) closeImage();
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      // Not a held Enter that just opened the photo from a control.
      !event.repeat &&
      !event.isComposing &&
      !isControl(event.target) &&
      view.value.selected
    ) {
      // Enter opens the photo's detail page, like its button, as a new
      // entry over the overlay's: Back from it returns to the photo open
      // over its list. A focused link or button keeps its own Enter.
      window.location.assign(
        photoDetailUrl(
          current,
          state.filter,
          state.sort,
          view.value.camera,
          state.date,
        ),
      );
    }
  });

  // Window/document listeners are bound to this root element rather than via
  // useOnWindow/useOnDocument: with those, Qwik 1.19 also copies the listeners
  // onto the first element created in a client re-render (the overlay), so
  // every keydown ran twice and ArrowRight skipped a photo.
  return (
    <>
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
              {state.date !== null && <DateHeader date={state.date} />}
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
                  {/* The site's other places, at the right of the first
                    line (on a camera or date page, in its header's). */}
                  {camera === null && state.date === null && (
                    <SiteNav compact />
                  )}
                </div>
                <div
                  role="group"
                  aria-label="タグで絞り込む"
                  class="flex flex-wrap items-center gap-2"
                >
                  {tagCounts(scope.map((m) => m.value)).map(
                    ({ tag, count }) => {
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
                    },
                  )}
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
                Justified rows (tile.ts): each tile keeps its photo's
                aspect ratio and a row's tiles widen by the same factor, so
                a row stays straight and no photo is cropped. The row
                height steps with the width, so a 16:9 photo sits about
                2-3 per row. The trailing filler takes the last row's
                space so it is not stretched.
              */}
              <div
                ref={grid}
                data-testid="gallery-grid"
                class="flex flex-wrap items-start gap-1 [--row-h:6rem] sm:[--row-h:8rem] md:[--row-h:10rem] lg:[--row-h:12rem] xl:[--row-h:15rem]"
              >
                {
                  // 選択した画像をオーバーレイ表示
                  selected && (
                    // Keyed by photo so stepping to the next one starts
                    // from its thumbnail with a fresh progress bar.
                    <PhotoOverlay
                      key={selected.id}
                      src={{ id: selected.id, file: selected.file }}
                      onClose$={closeImage}
                      info={selected}
                      detailHref={photoDetailUrl(
                        selected.id,
                        state.filter,
                        state.sort,
                        camera,
                        state.date,
                      )}
                      tagLinks={mediaTags(selected).map((tag) => ({
                        tag,
                        href: galleryUrl(tagOnly(tag), state.sort, camera),
                      }))}
                      onTag$={filterByTag}
                      neighbors={view.value.neighbors}
                      onStep$={step}
                    />
                  )
                }
                {
                  // 画像の一覧表示
                  filteredMedia.map((m) => {
                    const id = m.value.id;
                    const known = hasKnownSize(m.value);
                    return (
                      <div
                        key={id}
                        data-testid="gallery-tile"
                        data-photo-id={id}
                        class="group relative aspect-(--ar) min-w-0 basis-[calc(var(--row-h)*var(--ar))] overflow-hidden"
                        style={tileStyle(tileAspect(m.value, natural[id]))}
                      >
                        <img
                          data-testid="gallery-image"
                          // Its size is not known: the tile is 3:2 until the
                          // image loads, then takes the image's own shape.
                          data-unsized={known ? undefined : id}
                          class="block h-full w-full cursor-pointer object-cover"
                          {...photoSize(m.value)}
                          onLoad$={
                            known
                              ? undefined
                              : $((_: Event, img: HTMLImageElement) => {
                                  const a = aspectOf(
                                    img.naturalWidth,
                                    img.naturalHeight,
                                  );
                                  if (a !== null) natural[id] = a;
                                })
                          }
                          onClick$={() => openImage(id)}
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
                    );
                  })
                }
                {/*
                  A string: Qwik adds "px" to a number under a kebab-case
                  key. -ml-1 takes back the gap, so the filler fits even
                  after a full last row (never a line of its own).
                */}
                <div
                  aria-hidden="true"
                  class="-ml-1"
                  style={{ "flex-grow": String(FILLER_GROW) }}
                />
              </div>
            </>
          );
        })()}
      </div>
      {/* A camera's list ends with the photos digitised with it, on its
          page and on a photo URL over it alike. */}
      {view.value.camera !== null && (
        <DigitizedList media={view.value.digitized} />
      )}
    </>
  );
});
