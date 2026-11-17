import {
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";

import { GRID_CANDIDATES, imageUrl, srcSet } from "./images";
import { pickOverlayPreset, readWithProgress } from "./progress";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

// The photo box is 90vw × 90vh; the image is drawn at most this wide.
const BOX_WIDTH_RATIO = 0.9;

interface PhotoOverlayProps {
  file: string;
  onClose$: QRL<() => void>;
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
    const file = track(() => props.file);
    fullSrc.value = undefined;
    progress.value = 0;

    const preset = pickOverlayPreset(
      window.innerWidth * BOX_WIDTH_RATIO,
      window.devicePixelRatio || 1,
    );
    const url = imageUrl(S3_BASE, file, IMAGE_BASE, preset);
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

  const percent =
    typeof progress.value === "number"
      ? Math.round(progress.value * 100)
      : undefined;

  return (
    <div
      data-testid="overlay"
      onClick$={() => props.onClose$()}
      // Translucent so the grid stays visible behind the photo.
      class="fixed inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm"
    >
      <div class="relative flex h-[85vh] w-[90vw] items-center justify-center">
        <img
          aria-hidden="true"
          src={imageUrl(S3_BASE, props.file, IMAGE_BASE, "h240")}
          srcset={srcSet(S3_BASE, props.file, IMAGE_BASE, GRID_CANDIDATES)}
          class="absolute inset-0 h-full w-full object-contain"
        />
        {fullSrc.value && (
          <img
            data-testid="overlay-image"
            src={fullSrc.value}
            class="absolute inset-0 h-full w-full object-contain"
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
        // Kept in the layout (invisible when done) so the photo doesn't
        // jump when the bar disappears.
        class={[
          // Wide enough to read the progress at a glance, but narrower
          // than the photo box (90vw) so it reads as part of the photo.
          "h-1 w-[min(60vw,48rem)] overflow-hidden rounded-full bg-white/20 transition-opacity duration-300",
          progress.value === undefined ? "opacity-0" : "opacity-100",
        ]}
      >
        <div
          class={[
            "h-full rounded-full bg-white/80",
            percent === undefined
              ? "w-1/3 animate-pulse"
              : "transition-[width] duration-150",
          ]}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
});
