import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { overlayClass } from "@shared/overlay/styles";
import {
  LIST_CANDIDATES,
  dimensionsFromFile,
  imageUrl,
  srcSet,
} from "~/lib/images";
import {
  OVERLAY_BOX_WIDTH_RATIO,
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "~/lib/progress";
import type { MediaWorld } from "~/lib/types";
import { Thumb } from "./thumb";

type Props = {
  file: string;
  world: MediaWorld;
  /** /thumb base, or null for the placeholder (no full-screen view). */
  imageBase: string | null;
};

/**
 * The edit page's photo: the inline preview (loads progressively, see
 * ProgressivePreview), and a tap on it opens a full-screen view with the
 * same look and loading as the public gallery's overlay (shared/overlay/).
 */
export const PhotoPreview = component$<Props>((props) => {
  const dialog = useSignal<HTMLDialogElement>();
  const trigger = useSignal<HTMLButtonElement>();
  const open = useSignal(false);
  const boxClass =
    "w-full rounded-xl border border-zinc-200 dark:border-zinc-800";

  if (!props.imageBase) {
    return (
      <Thumb
        file={props.file}
        world={props.world}
        imageBase={null}
        variant="preview"
        class={boxClass}
      />
    );
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="写真を全画面で表示"
        aria-haspopup="dialog"
        onClick$={() => {
          dialog.value?.showModal();
          open.value = true;
        }}
        class="block w-full cursor-zoom-in rounded-xl"
      >
        <Thumb
          file={props.file}
          world={props.world}
          imageBase={props.imageBase}
          variant="preview"
          class={boxClass}
        />
      </button>
      {/* A modal <dialog> (focus stays in it, Escape closes it) that is
          itself transparent: the overlay's translucent backdrop inside
          shows the page behind, like the public gallery. A click anywhere
          closes it, as there. */}
      <dialog
        ref={dialog}
        aria-label={`Preview of ${props.file}`}
        data-testid="fullscreen"
        onClick$={() => dialog.value?.close()}
        onClose$={() => {
          open.value = false;
          trigger.value?.focus();
        }}
        class="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-transparent"
      >
        <FullscreenImage
          file={props.file}
          imageBase={props.imageBase}
          open={open.value}
        />
      </dialog>
    </>
  );
});

type ImageProps = { file: string; imageBase: string; open: boolean };

/**
 * The thumbnail the inline preview already shows (same URL and srcset, so
 * it comes from the browser cache and is drawn in the first frame; never
 * an empty backdrop), then the overlay preset for this screen fetched with
 * progress while the view is open and stacked on top as a blob: URL.
 * Closing cancels a download in progress; a finished one is kept for the
 * next opening.
 */
const FullscreenImage = component$<ImageProps>((props) => {
  const fullSrc = useSignal<string>();
  /** The file fullSrc belongs to. */
  const loadedFile = useSignal<string>();
  // Fraction downloaded in [0, 1], null while the size is unknown, and
  // undefined when there is nothing to show (not open, done or failed).
  const progress = useSignal<number | null | undefined>(undefined);

  // A visible task, eagerly (the closed dialog is never "visible"): it
  // starts the download when the view opens.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      const open = track(() => props.open);
      const file = track(() => props.file);
      const base = track(() => props.imageBase);
      if (loadedFile.value !== file) {
        // Another photo (client-side navigation reused this component).
        if (fullSrc.value?.startsWith("blob:")) {
          URL.revokeObjectURL(fullSrc.value);
        }
        fullSrc.value = undefined;
        loadedFile.value = undefined;
      }
      if (!open || fullSrc.value) {
        progress.value = undefined;
        return;
      }

      progress.value = 0;
      const preset = pickOverlayPreset(
        window.innerWidth * OVERLAY_BOX_WIDTH_RATIO,
        window.devicePixelRatio || 1,
      );
      const url = imageUrl(base, file, preset);
      const controller = new AbortController();
      const stale = () => controller.signal.aborted;
      let fallback: HTMLImageElement | undefined;

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
            fullSrc.value = URL.createObjectURL(blob);
            loadedFile.value = file;
            progress.value = undefined;
          });
        })
        .catch(() => {
          if (stale()) return;
          // Network failure: let the browser load it directly (no
          // progress, so the bar turns indeterminate) and stack it only
          // once it is complete; on error the thumbnail simply stays.
          progress.value = null;
          fallback = new Image();
          fallback.onload = () => {
            fullSrc.value = url;
            loadedFile.value = file;
            progress.value = undefined;
          };
          fallback.onerror = () => {
            progress.value = undefined;
          };
          fallback.src = url;
        });

      // Closed (or another photo) before it finished: stop downloading.
      cleanup(() => {
        controller.abort();
        if (fallback) {
          fallback.onload = fallback.onerror = null;
          fallback.src = ""; // cancels the download
        }
      });
    },
    { strategy: "document-ready" },
  );

  // Unmounted: free the blob.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      cleanup(() => {
        if (fullSrc.value?.startsWith("blob:")) {
          URL.revokeObjectURL(fullSrc.value);
        }
      });
    },
    { strategy: "document-ready" },
  );

  const percent = progressPercent(progress.value);
  return (
    <div class={overlayClass.backdrop}>
      <div class={overlayClass.box}>
        <img
          data-testid="fullscreen-thumb"
          aria-hidden="true"
          src={imageUrl(props.imageBase, props.file, "h240")}
          srcset={srcSet(props.imageBase, props.file, LIST_CANDIDATES)}
          {...dimensionsFromFile(props.file)}
          // No broken-image icon if it fails.
          onError$={(_, el) => {
            el.hidden = true;
          }}
          class={overlayClass.image}
        />
        {fullSrc.value && (
          <img
            data-testid="fullscreen-image"
            src={fullSrc.value}
            alt={`Preview of ${props.file}`}
            class={overlayClass.image}
          />
        )}
      </div>
      <div
        data-testid="fullscreen-progress"
        role="progressbar"
        aria-label="写真を読み込み中"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-hidden={progress.value === undefined ? "true" : undefined}
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
    </div>
  );
});
