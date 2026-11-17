import {
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";

import {
  OVERLAY_BOX_WIDTH_RATIO,
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "@shared/overlay/progress";
import { overlayClass } from "@shared/overlay/styles";
import { GRID_CANDIDATES, imageUrl, srcSet, type ImageSource } from "./images";
import { ShareButton } from "./share-button";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

interface PhotoOverlayProps {
  /** A photo (by public id) or a camera picture (by bucket path). */
  src: ImageSource;
  onClose$: QRL<() => void>;
  /** Show the share button (default); off where the URL is not the photo's. */
  share?: boolean;
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
      class={overlayClass.backdrop}
    >
      <div class={overlayClass.box}>
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
    </div>
  );
});
