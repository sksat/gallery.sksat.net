import {
  $,
  component$,
  useComputed$,
  useContextProvider,
  useSignal,
} from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { useGalleryIndex } from "~/routes/layout";
import { takenDateKey } from "@shared/calendar/calendar";
import type { SwipeDirection } from "@shared/gestures/swipe";
import { Manufacturer } from "./camera-header";
import { CAMERA_PREVIEWS } from "./camera-link";
import {
  CAMERA_KIND_LABELS,
  cameraHref,
  cameraPreviews,
  findCamera,
} from "./cameras";
import { photoContext } from "./detail";
import { imageUrl, photoSize } from "./images";
import { isTextTarget } from "./keys";
import { galleryUrl } from "./logic";
import { SiteNav } from "../layout/site-nav";
import { MiniMap } from "../map/mini-map";
import { MiniCalendar } from "./mini-calendar";
import { photoInfo } from "./photo-info";
import {
  ExposureSpecs,
  PhotoInfoList,
  PhotoTitle,
  TakenText,
} from "./photo-info-list";
import { ProgressiveImage } from "./progressive-image";
import { ShareButton } from "./share-button";
import { DEFAULT_TAG_MODE, mediaTags } from "./tags";
import { transformMediaInfo, type MediaInfoJSON } from "./types";
import { useSwipe } from "./use-swipe";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/** The camera card, calendar and map: each a way to more photos. */
const CARD = "rounded-2xl bg-white/[0.04] ring-1 ring-white/10 ring-inset";

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
 * The previous / next link: under the photo on phones (a labelled pill),
 * and from sm up the whole height of the photo's band at its edge, its
 * chevron in a circle that lights up on hover.
 */
const StepLink = component$<{ dir: "prev" | "next"; href: string }>(
  ({ dir, href }) => {
    const label = dir === "prev" ? "前の写真" : "次の写真";
    return (
      // Plain <a>: see the note in components/layout/header.tsx.
      <a
        href={href}
        rel={dir}
        data-testid={`${dir}-link`}
        aria-label={label}
        title={`${label} (${dir === "prev" ? "←" : "→"})`}
        class={[
          "group flex items-center gap-1 rounded-full bg-white/[0.06] py-2 text-sm !text-white/85 ring-1 ring-white/10 ring-inset hover:bg-white/15 hover:!text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
          dir === "prev" ? "pr-4 pl-2" : "ml-auto flex-row-reverse pr-2 pl-4",
          // From sm: a full-height zone at the band's edge.
          "sm:absolute sm:inset-y-0 sm:w-20 sm:justify-center sm:rounded-none sm:bg-transparent sm:p-0 sm:ring-0 sm:hover:bg-white/[0.04] sm:focus-visible:-outline-offset-4",
          dir === "prev" ? "sm:left-0" : "sm:right-0",
        ]}
      >
        <span class="sm:flex sm:size-11 sm:items-center sm:justify-center sm:rounded-full sm:bg-black/40 sm:ring-1 sm:ring-white/15 sm:transition-colors sm:group-hover:bg-white/90 sm:group-hover:text-black">
          <Chevron dir={dir} />
        </span>
        <span class="sm:sr-only">{label}</span>
      </a>
    );
  },
);

/**
 * A photo's detail page (/photo/<id>/detail/): the photo as a wide band
 * across the page, then its title (the date, with the world or place),
 * the exposure readout and the other details, and beside them the
 * camera, the day and the place as cards. Previous / next and the way
 * back go through the list it was opened from (carried in the query).
 * Server-rendered in full; the arrow keys and swipes step like the
 * overlay's.
 */
export const PhotoDetail = component$<{ photo: MediaInfoJSON }>((props) => {
  const location = useLocation();
  const index = useGalleryIndex();
  // Its スキャン機材 link previews the device (camera-link.tsx).
  const cameraCards = useComputed$(() =>
    cameraPreviews(
      index.value.media.map(transformMediaInfo),
      index.value.cameras,
    ),
  );
  useContextProvider(CAMERA_PREVIEWS, cameraCards);

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
      // lens).
      info: { ...info, camera: camera ? null : info.camera },
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

  const { photo, ctx, camera, listed, info, backLabel, tagLinks } = page.value;
  const cover = camera?.images[0]?.file;
  const size = photoSize(photo);
  const aspect = "width" in size ? `${size.width} / ${size.height}` : "3 / 2";
  const hasCalendar =
    takenDateKey(photo.takenIso ?? null, photo.timestamp_precision) !== null;
  const hasMap = props.photo.location != null;

  return (
    <article
      data-testid="photo-detail"
      aria-labelledby="photo-detail-title"
      // On an element: see gallery.tsx on why not useOnDocument.
      document:onKeyDown$={onKeyDown}
      class="pb-14"
    >
      <div class="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2 sm:px-6">
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

      {/* The date names the photo, at the top above it, as in the overlay.
          `!`: the site's unlayered h1 rules would win otherwise. */}
      <h1
        id="photo-detail-title"
        data-testid={info.taken ? "info-taken" : undefined}
        class={[
          "mx-auto max-w-6xl px-4 pt-1 pb-4 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums sm:px-6 sm:pt-2 sm:pb-5 sm:text-4xl",
          info.taken ? "" : "sr-only",
        ]}
      >
        {info.taken ? <TakenText taken={info.taken} /> : "写真"}
      </h1>

      {/* The photo: a dark band across the whole page, the photo as large
          as fits in it (the screen's width on phones). */}
      <div
        ref={area}
        data-testid="photo-area"
        class="relative overflow-hidden bg-black/45 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),inset_0_-1px_0_rgb(255_255_255/0.04)]"
      >
        <div class="mx-auto flex max-w-[110rem] flex-col items-center gap-2 sm:h-[min(80svh,58rem)] sm:justify-center sm:px-24 sm:py-8">
          <ProgressiveImage
            src={{ id: photo.id, file: photo.file }}
            boxRef={box}
            // Phones: the photo's own shape at the screen's width (at most
            // most of the screen tall), set before it loads so nothing
            // shifts; 3:2 when its size is not known. From sm: the band.
            boxClass="relative max-h-[75svh] w-full sm:h-full sm:max-h-none"
            boxStyle={{ aspectRatio: aspect }}
            alt={info.taken ? `${info.taken.text} の写真` : "写真"}
          />
        </div>
        {(ctx.prevHref || ctx.nextHref) && (
          <div class="flex px-3 pb-3 sm:contents">
            {ctx.prevHref && <StepLink dir="prev" href={ctx.prevHref} />}
            {ctx.nextHref && <StepLink dir="next" href={ctx.nextHref} />}
          </div>
        )}
      </div>

      <div class="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">
        <div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
          <div class="flex min-w-0 flex-col gap-8 sm:gap-10">
            <PhotoTitle info={info} photoId={photo.id} large />
            <div class="flex max-w-xl flex-col gap-4">
              {info.exposure && <ExposureSpecs specs={info.exposure} />}
              <PhotoInfoList info={info} tagLinks={tagLinks} />
            </div>
          </div>

          <div class="flex flex-col gap-4">
            {camera && (
              <div
                data-testid="camera-card"
                class={[
                  "relative flex items-center gap-4 transition-colors hover:bg-white/[0.08]",
                  cover ? "p-3" : "px-4 py-3",
                  CARD,
                ]}
              >
                {/* Its picture, when it has one; else just its name. */}
                {cover && (
                  <div class="size-20 shrink-0 overflow-hidden rounded-xl bg-white/5">
                    <img
                      src={imageUrl(S3_BASE, cover, IMAGE_BASE, "h240")}
                      alt=""
                      width={80}
                      height={80}
                      decoding="async"
                      class="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div class="flex min-w-0 flex-col gap-1 text-sm">
                  <span class="text-white/55">カメラ</span>
                  <a
                    href={cameraHref(camera.slug)}
                    class="truncate text-base font-semibold !text-white after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-white"
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
            {(hasCalendar || hasMap) && (
              <div
                class={[
                  "grid gap-4",
                  hasCalendar && hasMap && "sm:grid-cols-2 lg:grid-cols-1",
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
      </div>
    </article>
  );
});
