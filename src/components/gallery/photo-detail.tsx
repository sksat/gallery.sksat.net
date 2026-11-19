import { $, component$, useComputed$, useSignal } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { useGalleryIndex } from "~/routes/layout";
import type { SwipeDirection } from "@shared/gestures/swipe";
import { Manufacturer } from "./camera-header";
import { CAMERA_KIND_LABELS, cameraHref, findCamera } from "./cameras";
import { photoContext } from "./detail";
import { dimensionsFromFile, imageUrl } from "./images";
import { isTextTarget } from "./keys";
import { galleryUrl } from "./logic";
import { MiniMap } from "../map/mini-map";
import { MiniCalendar } from "./mini-calendar";
import { photoInfo } from "./photo-info";
import { PhotoInfoList } from "./photo-info-list";
import { ProgressiveImage } from "./progressive-image";
import { ShareButton } from "./share-button";
import { DEFAULT_TAG_MODE, mediaTags } from "./tags";
import { transformMediaInfo, type MediaInfoJSON } from "./types";
import { useSwipe } from "./use-swipe";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

// `!` on the colour: the site's unlayered `a { color }` would win otherwise.
const ROUND_BUTTON =
  "flex size-10 items-center justify-center rounded-full bg-black/50 !text-white/80 hover:bg-black/70 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

const Chevron = component$<{ dir: "prev" | "next" }>(({ dir }) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={dir === "prev" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
));

/**
 * A photo's own page (/photo/<id>/): the photo large, everything public
 * about it, and the previous / next photo and a way back to the list it
 * was opened from (carried in the query). Server-rendered in full; the
 * arrow keys and swipes step like the overlay's.
 */
export const PhotoDetail = component$<{ photo: MediaInfoJSON }>((props) => {
  const location = useLocation();
  const index = useGalleryIndex();

  const page = useComputed$(() => {
    const media = index.value.media.map(transformMediaInfo);
    const photo = transformMediaInfo(props.photo);
    const ctx = photoContext(
      media,
      index.value.cameras,
      photo.id,
      location.url.searchParams,
    );
    const camera =
      photo.camera === null
        ? null
        : findCamera(index.value.cameras, media, photo.camera.slug);
    const info = photoInfo(photo);
    return {
      photo,
      ctx,
      camera,
      /** In the public list (not unlisted). */
      listed: media.some((m) => m.id === photo.id),
      // The camera card shows the camera (the list keeps its body and
      // lens), and the small map the place.
      info: {
        ...info,
        camera: camera ? null : info.camera,
        location: null,
      },
      backLabel:
        ctx.camera === null
          ? "写真一覧"
          : (findCamera(index.value.cameras, media, ctx.camera)?.name ??
            ctx.camera),
      tagLinks: mediaTags(photo).map((tag) => ({
        tag,
        href: galleryUrl(
          null,
          { tags: [tag], mode: DEFAULT_TAG_MODE },
          ctx.sort,
          ctx.camera,
        ),
      })),
    };
  });

  const area = useSignal<HTMLElement>();
  const box = useSignal<HTMLElement>();
  const neighbors = useComputed$(() => ({
    prev: page.value.ctx.prevHref !== null,
    next: page.value.ctx.nextHref !== null,
  }));
  const go = $((dir: SwipeDirection) => {
    const href = page.value.ctx[dir === "prev" ? "prevHref" : "nextHref"];
    if (!href) return;
    // Put the swiped photo back first: Back may restore this page as it
    // was (bfcache).
    if (box.value) {
      box.value.style.transition = "";
      box.value.style.transform = "";
    }
    window.location.assign(href);
  });
  useSwipe({ area, follow: box, neighbors, onStep$: go });

  const onKeyDown = $((e: KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.repeat) return;
    if (isTextTarget(e.target)) return;
    if (e.key === "ArrowLeft") go("prev");
    else if (e.key === "ArrowRight") go("next");
  });

  const { photo, ctx, camera, listed, info, backLabel, tagLinks } = page.value;
  const cover = camera?.images[0]?.file;
  const size = dimensionsFromFile(photo.file);
  const aspect = "width" in size ? `${size.width} / ${size.height}` : "3 / 2";

  return (
    <article
      data-testid="photo-detail"
      aria-labelledby="photo-detail-title"
      // On an element: see gallery.tsx on why not useOnDocument.
      document:onKeyDown$={onKeyDown}
      class="mx-auto flex max-w-7xl flex-col gap-6 px-3 py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 lg:px-6"
    >
      <h1 id="photo-detail-title" class="sr-only">
        {info.taken ? `${info.taken.text} の写真` : "写真"}
      </h1>
      <div class="flex min-w-0 flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          {/* Plain <a>s: see the note in components/layout/header.tsx. */}
          <a
            href={ctx.backHref}
            data-testid="back-link"
            class="truncate text-sm opacity-80 hover:opacity-100"
          >
            <span aria-hidden="true">← </span>
            {backLabel}
          </a>
          <ShareButton photoId={photo.id} variant="inline" />
        </div>
        <div
          ref={area}
          class="relative flex flex-col items-center gap-3 overflow-hidden"
        >
          <ProgressiveImage
            src={{ id: photo.id, file: photo.file }}
            boxRef={box}
            // The photo's aspect ratio at the column's width (at most most
            // of the screen tall), set before it loads so nothing shifts;
            // 3:2 when its size is not known.
            boxClass="relative max-h-[min(75vh,60rem)] w-full"
            boxStyle={{ aspectRatio: aspect }}
            alt={info.taken ? `${info.taken.text} の写真` : "写真"}
          />
          {ctx.prevHref && (
            <a
              href={ctx.prevHref}
              rel="prev"
              data-testid="prev-link"
              aria-label="前の写真"
              title="前の写真 (←)"
              class={["absolute top-1/2 left-2 -translate-y-1/2", ROUND_BUTTON]}
            >
              <Chevron dir="prev" />
            </a>
          )}
          {ctx.nextHref && (
            <a
              href={ctx.nextHref}
              rel="next"
              data-testid="next-link"
              aria-label="次の写真"
              title="次の写真 (→)"
              class={[
                "absolute top-1/2 right-2 -translate-y-1/2",
                ROUND_BUTTON,
              ]}
            >
              <Chevron dir="next" />
            </a>
          )}
        </div>
      </div>

      {/* The h1 is absolutely positioned (sr-only), so it takes no cell. */}
      <div class="flex flex-col gap-6 text-sm text-white lg:pt-11">
        <PhotoInfoList info={info} tagLinks={tagLinks} />
        {camera && (
          <div
            data-testid="camera-card"
            class="relative flex items-center gap-3 rounded border border-white/15 p-2 transition-colors hover:border-white/50"
          >
            <div class="size-16 shrink-0 overflow-hidden rounded bg-white/5">
              {cover && (
                <img
                  src={imageUrl(S3_BASE, cover, IMAGE_BASE, "h240")}
                  alt=""
                  width={64}
                  height={64}
                  decoding="async"
                  class="h-full w-full object-cover"
                />
              )}
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-white/60">カメラ</span>
              <a
                href={cameraHref(camera.slug)}
                class="truncate font-semibold text-white after:absolute after:inset-0 after:content-['']"
              >
                {camera.name}
              </a>
              {(camera.manufacturer || camera.kind) && (
                <span class="flex gap-3 text-white/70">
                  {camera.manufacturer && (
                    <span class={camera.manufacturerUrl ? "relative z-10" : ""}>
                      <Manufacturer camera={camera} />
                    </span>
                  )}
                  {camera.kind && (
                    <span>{CAMERA_KIND_LABELS[camera.kind]}</span>
                  )}
                </span>
              )}
            </div>
          </div>
        )}
        <MiniCalendar
          timestamp={photo.takenIso ?? null}
          precision={photo.timestamp_precision}
          // An unlisted photo is on no day's list.
          linkDay={listed}
        />
        {/* Only a public location (never for a VRChat photo). */}
        {props.photo.location && (
          <MiniMap photoId={photo.id} location={props.photo.location} />
        )}
      </div>
    </article>
  );
});
