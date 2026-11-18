import {
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";
import { isBrowser } from "@builder.io/qwik/build";

import {
  OVERLAY_BOX_WIDTH_RATIO,
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "@shared/overlay/progress";
import { overlayClass } from "@shared/overlay/styles";
import { GRID_CANDIDATES, imageUrl, srcSet, type ImageSource } from "./images";
import { InfoPanel, initialOpen, type TagLink } from "./info-panel";
import { ShareButton } from "./share-button";
import type { MediaInfo } from "./types";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

interface PhotoOverlayProps {
  /** A photo (by public id) or a camera picture (by bucket path). */
  src: ImageSource;
  onClose$: QRL<() => void>;
  /** Show the share button (default); off where the URL is not the photo's. */
  share?: boolean;
  /** The photo, for its info panel; none for a camera picture. */
  info?: MediaInfo;
  /** The info panel's tags with their gallery URLs. */
  tagLinks?: TagLink[];
  /** Filter the gallery by a tag from the info panel. */
  onTag$?: QRL<(tag: string) => void>;
}

/**
 * Full-screen view of one photo.
 *
 * The grid thumbnail (same srcset as the grid, so the browser reuses the
 * cached file) shows at once, scaled up. The full-size image is fetched in a
 * visible task so the download progress can be shown under the photo, then
 * stacked on top of the thumbnail as a blob: URL. A visible task (rather
 * than an <img> onLoad$) also runs when the overlay was server-rendered on
 * /photo/N, where a load event could fire before Qwik resumes.
 */
export const PhotoOverlay = component$<PhotoOverlayProps>((props) => {
  const fullSrc = useSignal<string>();
  // Fraction downloaded in [0, 1], null while the size is unknown, and
  // undefined once there is nothing to show (done or failed).
  const progress = useSignal<number | null | undefined>(0);
  // The info panel: null on the server (CSS shows the breakpoint's
  // default until the browser picks); decided at once when the overlay is
  // created in the browser, so stepping photos does not flicker it.
  const infoOpen = useSignal<boolean | null>(() =>
    isBrowser ? initialOpen() : null,
  );

  // A visible task is intended: the download must start when the overlay is
  // on screen, including when it was server-rendered. The task only starts
  // an async fetch, so it does not block the main thread.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const src = track(() => props.src);
    fullSrc.value = undefined;
    progress.value = 0;

    const preset = pickOverlayPreset(
      window.innerWidth * OVERLAY_BOX_WIDTH_RATIO,
      window.devicePixelRatio || 1,
    );
    const url = imageUrl(S3_BASE, src, IMAGE_BASE, preset);
    const controller = new AbortController();
    let objectUrl: string | undefined;

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return readWithProgress(response, (f) => {
          progress.value = f;
        });
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        fullSrc.value = objectUrl;
        progress.value = undefined;
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Let the browser load it directly (e.g. a cross-origin original
        // without CORS in development); no progress then.
        fullSrc.value = url;
        progress.value = undefined;
      });

    cleanup(() => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  });

  const percent = progressPercent(progress.value);

  // The look (shared/overlay/styles.ts) is shared with the admin's
  // full-screen preview.
  return (
    <div
      data-testid="overlay"
      onClick$={() => props.onClose$()}
      class={[
        overlayClass.backdrop,
        // On desktops the open info panel takes the right edge; the photo
        // moves left of it rather than under it.
        props.info && "md:transition-[padding] md:duration-200",
        props.info && infoOpen.value !== false && "md:pr-[19.5rem]",
      ]}
    >
      <div class={[overlayClass.box, "max-w-full"]}>
        <img
          aria-hidden="true"
          src={imageUrl(S3_BASE, props.src, IMAGE_BASE, "h240")}
          srcset={srcSet(S3_BASE, props.src, IMAGE_BASE, GRID_CANDIDATES)}
          class={overlayClass.image}
        />
        {fullSrc.value && (
          <img
            data-testid="overlay-image"
            src={fullSrc.value}
            class={overlayClass.image}
          />
        )}
      </div>
      <div
        data-testid="overlay-progress"
        role="progressbar"
        aria-label="写真を読み込み中"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        class={[
          overlayClass.progress,
          progress.value === undefined
            ? overlayClass.progressDone
            : overlayClass.progressActive,
        ]}
      >
        <div
          class={[
            overlayClass.progressFill,
            percent === undefined
              ? overlayClass.progressIndeterminate
              : overlayClass.progressDeterminate,
          ]}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      {props.share !== false && <ShareButton />}
      {props.info && props.onTag$ && (
        <InfoPanel
          photo={props.info}
          tagLinks={props.tagLinks ?? []}
          onTag$={props.onTag$}
          open={infoOpen}
        />
      )}
    </div>
  );
});
