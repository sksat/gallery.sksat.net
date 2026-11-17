import {
  component$,
  useSignal,
  useVisibleTask$,
  type ClassList,
} from "@builder.io/qwik";
import {
  LIST_CANDIDATES,
  dimensionsFromFile,
  imageUrl,
  srcSet,
} from "~/lib/images";
import { pickPreviewPreset, readWithProgress } from "~/lib/progress";

type Props = {
  file: string;
  imageBase: string;
  /** Box size/rounding; the aspect ratio is fixed by the caller (Thumb). */
  class?: ClassList;
};

/**
 * Edit page preview that loads progressively, like the public gallery's
 * photo overlay.
 *
 * The list thumbnail (same src/srcset as the list, so the browser reuses
 * the cached file) shows at once, scaled up. The larger preview (w1200 or
 * w1920 by drawn width × DPR) is fetched in a visible task so its download
 * progress can be shown along the bottom edge, then stacked on top as a
 * blob: URL. A visible task (rather than an <img> onLoad$) also runs when
 * the page was server-rendered, where a load event could fire before Qwik
 * resumes. If the fetch fails (e.g. the Worker does not send CORS headers),
 * the image is loaded without progress (indeterminate bar) and stacked once
 * complete.
 */
export const ProgressivePreview = component$<Props>((props) => {
  const { file, imageBase, class: boxClass } = props;
  const box = useSignal<HTMLElement>();
  const fullSrc = useSignal<string>();
  // Fraction downloaded in [0, 1], null while the size is unknown, and
  // undefined once there is nothing to show (done or failed).
  const progress = useSignal<number | null | undefined>(0);

  // A visible task is intended: the download must start once the preview
  // is on screen, including when it was server-rendered. The task only
  // starts an async fetch, so it does not block the main thread.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    // Re-run when client-side navigation reuses this component for
    // another photo.
    const current = track(() => props.file);
    const base = track(() => props.imageBase);
    fullSrc.value = undefined;
    progress.value = 0;

    const preset = pickPreviewPreset(
      box.value?.clientWidth || window.innerWidth,
      window.devicePixelRatio || 1,
    );
    const url = imageUrl(base, current, preset);
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let fallback: HTMLImageElement | undefined;
    // After cleanup (another photo, or unmounted) a settled read must not
    // touch the signals the next run owns.
    const stale = () => controller.signal.aborted;

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          // The Worker answered (e.g. 404): keep the thumbnail rather
          // than asking for the same failing transform again.
          if (!stale()) progress.value = undefined;
          return;
        }
        return readWithProgress(response, (f) => {
          if (!stale()) progress.value = f;
        }).then((blob) => {
          if (stale()) return;
          objectUrl = URL.createObjectURL(blob);
          fullSrc.value = objectUrl;
          progress.value = undefined;
        });
      })
      .catch(() => {
        if (stale()) return;
        // Network or CORS failure: let the browser load it directly (no
        // progress, so the bar turns indeterminate), and stack it only
        // once it is complete. On error the thumbnail simply stays.
        progress.value = null;
        fallback = new Image();
        fallback.onload = () => {
          fullSrc.value = url;
          progress.value = undefined;
        };
        fallback.onerror = () => {
          progress.value = undefined;
        };
        fallback.src = url;
      });

    cleanup(() => {
      controller.abort();
      if (fallback) {
        fallback.onload = fallback.onerror = null;
        fallback.src = ""; // cancels the download
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  });

  const percent =
    typeof progress.value === "number"
      ? Math.round(progress.value * 100)
      : undefined;
  const done = progress.value === undefined;

  return (
    <div ref={box} class={[boxClass, "bg-zinc-100 dark:bg-zinc-800"]}>
      <img
        src={imageUrl(imageBase, file, "h240")}
        srcset={srcSet(imageBase, file, LIST_CANDIDATES)}
        {...dimensionsFromFile(file)}
        alt={fullSrc.value ? "" : `Preview of ${file}`}
        decoding="async"
        // No broken-image icon: the empty box stays instead.
        onError$={(_, el) => {
          el.hidden = true;
        }}
        class="absolute inset-0 h-full w-full object-contain"
      />
      {fullSrc.value && (
        <img
          data-testid="preview-image"
          src={fullSrc.value}
          {...dimensionsFromFile(file)}
          alt={`Preview of ${file}`}
          class="absolute inset-0 h-full w-full object-contain"
        />
      )}
      <div
        data-testid="preview-progress"
        role="progressbar"
        aria-label="Loading preview"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-hidden={done ? "true" : undefined}
        // Along the bottom edge of the box, so the layout never shifts;
        // faded out (not removed) when done.
        class={[
          "absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/20 transition-opacity duration-300",
          done ? "opacity-0" : "opacity-100",
        ]}
      >
        <div
          class={[
            "h-full bg-sky-500",
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
