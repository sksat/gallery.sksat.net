import {
  component$,
  useSignal,
  useVisibleTask$,
  type Signal,
} from "@builder.io/qwik";

import {
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "@shared/overlay/progress";
import { overlayClass } from "@shared/overlay/styles";
import { GRID_CANDIDATES, imageUrl, srcSet, type ImageSource } from "./images";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

interface ProgressiveImageProps {
  src: ImageSource;
  /** Classes of the photo box (its size). */
  boxClass: string;
  /** The box, e.g. for a swipe to move it. */
  boxRef?: Signal<HTMLElement | undefined>;
  /** Describes the photo; without it the images are decorative. */
  alt?: string;
  /** Inline style of the box (e.g. its aspect ratio). */
  boxStyle?: Record<string, string>;
}

/**
 * A photo that shows at once and sharpens: the grid thumbnail (same srcset
 * as the grid, so the browser reuses the cached file) scaled up, then the
 * larger image, fetched in a visible task so its download progress shows
 * under the photo, stacked on top as a blob: URL. A visible task (rather
 * than an <img> onLoad$) also runs when the page was server-rendered, where
 * a load event could fire before Qwik resumes. Used by the overlay and the
 * photo page.
 */
export const ProgressiveImage = component$<ProgressiveImageProps>((props) => {
  const fullSrc = useSignal<string>();
  // Fraction downloaded in [0, 1], null while the size is unknown, and
  // undefined once there is nothing to show (done or failed).
  const progress = useSignal<number | null | undefined>(0);
  const ownBox = useSignal<HTMLElement>();
  const box = props.boxRef ?? ownBox;

  // A visible task is intended: the download must start when the photo is
  // on screen, including when it was server-rendered. The task only starts
  // an async fetch, so it does not block the main thread.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const src = track(() => props.src);
    fullSrc.value = undefined;
    progress.value = 0;

    // The preset for the box's width on screen.
    const preset = pickOverlayPreset(
      box.value?.clientWidth || window.innerWidth,
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

  return (
    <>
      <div
        ref={box}
        data-testid="overlay-box"
        class={props.boxClass}
        style={props.boxStyle}
      >
        <img
          aria-hidden={props.alt === undefined ? "true" : undefined}
          alt={fullSrc.value ? "" : props.alt}
          src={imageUrl(S3_BASE, props.src, IMAGE_BASE, "h240")}
          srcset={srcSet(S3_BASE, props.src, IMAGE_BASE, GRID_CANDIDATES)}
          class={overlayClass.image}
        />
        {fullSrc.value && (
          <img
            data-testid="overlay-image"
            src={fullSrc.value}
            alt={props.alt ?? ""}
            class={overlayClass.image}
          />
        )}
      </div>
      {/* Without JS nothing fills the bar: hide it. */}
      <noscript>
        <style>{"[data-photo-progress]{visibility:hidden}"}</style>
      </noscript>
      <div
        data-testid="overlay-progress"
        data-photo-progress
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
    </>
  );
});
