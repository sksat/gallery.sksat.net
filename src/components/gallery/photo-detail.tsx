import { $, component$, useComputed$, useSignal } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { useGalleryIndex } from "~/routes/layout";
import { takenDateKey } from "@shared/calendar/calendar";
import type { SwipeDirection } from "@shared/gestures/swipe";
import { Manufacturer } from "./camera-header";
import { CAMERA_KIND_LABELS, cameraHref, findCamera } from "./cameras";
import { photoContext } from "./detail";
import { imageUrl, photoSize } from "./images";
import { isTextTarget } from "./keys";
import { galleryUrl } from "./logic";
import { SiteNav } from "../layout/site-nav";
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
  "flex size-10 items-center justify-center rounded-full bg-white/[0.06] !text-white/80 ring-1 ring-white/10 ring-inset hover:bg-white/15 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

/** The camera card, calendar and map: each a way to more photos. */
const CARD = "rounded-xl bg-white/[0.04] ring-1 ring-white/10 ring-inset";

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
 * A photo's detail page (/photo/<id>/detail/): the photo large, everything public
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
      taken: info.taken,
      // The heading shows the date, the camera card the camera (the list
      // keeps its body and lens), and the small map the place.
      info: {
        ...info,
        taken: null,
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

  const { photo, ctx, camera, listed, taken, info, backLabel, tagLinks } =
    page.value;
  const cover = camera?.images[0]?.file;
  const size = photoSize(photo);
  const aspect = "width" in size ? `${size.width} / ${size.height}` : "3 / 2";
  const hasCalendar = takenDateKey(
    photo.takenIso ?? null,
    photo.timestamp_precision,
  );

  return (
    <article
      data-testid="photo-detail"
      aria-labelledby="photo-detail-title"
      // On an element: see gallery.tsx on why not useOnDocument.
      document:onKeyDown$={onKeyDown}
      class="mx-auto max-w-[96rem] px-3 pt-2 pb-8 sm:px-4 lg:px-8"
    >
      <div class="mb-2 flex items-center gap-3">
        {/* Plain <a>s: see the note in components/layout/header.tsx. */}
        <a
          href={ctx.backHref}
          data-testid="back-link"
          class="-ml-1 inline-flex min-h-11 min-w-0 items-center rounded px-1 text-sm !text-white/75 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:min-h-8"
        >
          <span aria-hidden="true" class="whitespace-pre">
            {"← "}
          </span>
          <span class="truncate">{backLabel}</span>
        </a>
        <span class="ml-auto flex shrink-0 items-center gap-1">
          <SiteNav compact />
          <ShareButton photoId={photo.id} variant="inline" />
        </span>
      </div>

      <div class="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10">
        {/* The photo on a dark mat: the screen's width on phones, with the
            previous / next buttons under it; from sm up the buttons sit in
            the mat's margins, beside the photo rather than over it. */}
        <div
          ref={area}
          class="relative -mx-3 flex flex-col items-center gap-3 overflow-hidden bg-black/30 sm:mx-0 sm:rounded-2xl sm:px-16 sm:py-6"
        >
          <ProgressiveImage
            src={{ id: photo.id, file: photo.file }}
            boxRef={box}
            // The photo's aspect ratio at the column's width (at most most
            // of the screen tall), set before it loads so nothing shifts;
            // 3:2 when its size is not known.
            boxClass="relative max-h-[min(78vh,60rem)] w-full"
            boxStyle={{ aspectRatio: aspect }}
            alt={taken ? `${taken.text} の写真` : "写真"}
          />
          {(ctx.prevHref || ctx.nextHref) && (
            <div class="-mt-1 flex w-full px-3 pb-3 sm:contents">
              {ctx.prevHref && (
                <a
                  href={ctx.prevHref}
                  rel="prev"
                  data-testid="prev-link"
                  aria-label="前の写真"
                  title="前の写真 (←)"
                  class={[
                    "sm:absolute sm:top-1/2 sm:left-3 sm:-translate-y-1/2",
                    ROUND_BUTTON,
                  ]}
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
                    "ml-auto sm:absolute sm:top-1/2 sm:right-3 sm:-translate-y-1/2",
                    ROUND_BUTTON,
                  ]}
                >
                  <Chevron dir="next" />
                </a>
              )}
            </div>
          )}
        </div>

        <div class="flex flex-col gap-6 px-1 text-white lg:sticky lg:top-6 lg:px-0">
          {/* The date names the photo. */}
          <h1
            id="photo-detail-title"
            data-testid={taken ? "info-taken" : undefined}
            class={[
              "text-2xl leading-tight font-semibold tracking-tight tabular-nums sm:text-[1.75rem]",
              taken ? "" : "sr-only",
            ]}
          >
            {taken ? (
              <time dateTime={taken.datetime}>{taken.text}</time>
            ) : (
              "写真"
            )}
          </h1>
          <PhotoInfoList info={info} tagLinks={tagLinks} />
          {camera && (
            <div
              data-testid="camera-card"
              class={[
                "relative flex items-center gap-4 p-3 transition-colors hover:bg-white/[0.08]",
                CARD,
              ]}
            >
              <div class="size-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
                {cover && (
                  <img
                    src={imageUrl(S3_BASE, cover, IMAGE_BASE, "h240")}
                    alt=""
                    width={56}
                    height={56}
                    decoding="async"
                    class="h-full w-full object-cover"
                  />
                )}
              </div>
              <div class="flex min-w-0 flex-col gap-1 text-sm">
                <span class="text-white/55">カメラ</span>
                <a
                  href={cameraHref(camera.slug)}
                  class="truncate text-[0.9375rem] font-semibold !text-white after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-white"
                >
                  {camera.name}
                </a>
                {(camera.manufacturer || camera.kind) && (
                  <span class="flex gap-3 text-white/65">
                    {camera.manufacturer && (
                      <span
                        class={camera.manufacturerUrl ? "relative z-10" : ""}
                      >
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
          {/* When and where: side by side where there is room. */}
          {(hasCalendar || props.photo.location) && (
            <div
              class={[
                "grid gap-3",
                hasCalendar &&
                  props.photo.location &&
                  "sm:grid-cols-2 lg:grid-cols-1",
              ]}
            >
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
          )}
        </div>
      </div>
    </article>
  );
});
