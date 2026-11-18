import {
  $,
  component$,
  useOnDocument,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@builder.io/qwik";
import { useLocation, useNavigate } from "@builder.io/qwik-city";
import { overlayClass } from "@shared/overlay/styles";
import { formatJst, splitPath } from "~/lib/format";
import {
  LIST_CANDIDATES,
  dimensionsFromFile,
  fileExtension,
  imageUrl,
  srcSet,
} from "~/lib/images";
import type { Neighbors } from "~/lib/neighbors";
import {
  OVERLAY_BOX_WIDTH_RATIO,
  pickOverlayPreset,
  progressPercent,
  readWithProgress,
} from "~/lib/progress";
import {
  AUTO_ADVANCE_KEY,
  VISIBILITY_KEYS,
  parseAutoAdvance,
  reviewKey,
  swipe,
  withViewer,
  withoutViewer,
} from "~/lib/review-keys";
import type { MediaWorld, Visibility } from "~/lib/types";
import { Thumb } from "./thumb";

/** Short labels for the viewer's visibility buttons. */
const VISIBILITY_JA: Record<Visibility, string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

export type QuickVisibilityResult =
  { ok: true; previous: Visibility } | { ok: false; message: string };

type Props = {
  id: number;
  file: string;
  world: MediaWorld;
  timestamp: string | null;
  visibility: Visibility;
  /** /thumb base, or null for placeholders. */
  imageBase: string | null;
  /** Previous / next in the list the page was opened from. */
  neighbors: Neighbors | null;
  /** The page's form has unsaved edits (quick changes would drop them). */
  dirty: boolean;
  /** Set one photo's visibility right away (the viewer's 1/2/3). */
  onVisibility$: QRL<
    (id: number, visibility: Visibility) => Promise<QuickVisibilityResult>
  >;
};

type Notice = {
  text: string;
  tone: "ok" | "error";
  /** What 「元に戻す」 restores. */
  undo?: { id: number; visibility: Visibility };
};

/**
 * The edit page's photo: the inline preview (loads progressively, see
 * ProgressivePreview), and a tap on it opens a full-screen viewer with the
 * same look and loading as the public gallery's overlay (shared/overlay/).
 *
 * The viewer is for going through photos quickly: ←/→ (or a swipe) step
 * through the list the page was opened from, staying in the viewer
 * (`?fs=1` in the URL, so a reload reopens it), and 1/2/3 or its buttons
 * set the visibility at once, then by default go on to the next photo.
 * ←/→ also work on the page itself when no field has focus.
 */
export const PhotoPreview = component$<Props>((props) => {
  const dialog = useSignal<HTMLDialogElement>();
  const trigger = useSignal<HTMLButtonElement>();
  const open = useSignal(false);
  const busy = useSignal(false);
  const notice = useSignal<Notice | null>(null);
  const autoAdvance = useSignal(true);
  const touchStart = useSignal<{ x: number; y: number } | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const boxClass =
    "w-full rounded-xl border border-zinc-200 dark:border-zinc-800";

  /** Keep `fs=1` in the address bar while the viewer is open. */
  const syncUrl = $((viewer: boolean) => {
    const here = location.pathname + location.search;
    const url = viewer ? withViewer(here) : withoutViewer(here);
    if (url !== here) history.replaceState(history.state, "", url);
  });
  const openViewer = $(async () => {
    if (!dialog.value?.open) dialog.value?.showModal();
    open.value = true;
    await syncUrl(true);
  });

  // Opened with ?fs=1 (a reload, or stepping through photos).
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track }) => {
      const fs = track(() => loc.url.searchParams.get("fs"));
      if (fs === "1") openViewer();
      try {
        autoAdvance.value = parseAutoAdvance(
          localStorage.getItem(AUTO_ADVANCE_KEY),
        );
      } catch {
        // Storage blocked: the default (on).
      }
    },
    { strategy: "document-ready" },
  );

  /** Previous / next photo; in the viewer, stay in it. */
  const go = $(async (dir: "prev" | "next") => {
    // Not while a quick change is saving: its reload would finish after
    // the navigation and bring the page back to the photo it was for.
    if (busy.value) return;
    const href = props.neighbors?.[dir];
    if (!href) return;
    if (open.value) {
      await nav(withViewer(href), { replaceState: true, scroll: false });
    } else {
      await nav(href);
    }
  });

  const setVisibility = $(async (visibility: Visibility) => {
    if (busy.value) return;
    if (props.dirty) {
      notice.value = {
        tone: "error",
        text: "保存していない変更があります。先に保存してください。",
      };
      return;
    }
    busy.value = true;
    const id = props.id;
    const result = await props.onVisibility$(id, visibility);
    busy.value = false;
    if (!result.ok) {
      notice.value = { tone: "error", text: `失敗しました: ${result.message}` };
      return;
    }
    notice.value = {
      tone: "ok",
      text: `#${id} を${VISIBILITY_JA[visibility]}にしました`,
      undo:
        result.previous === visibility
          ? undefined
          : { id, visibility: result.previous },
    };
    // (Only from the photo it was for.)
    if (autoAdvance.value && open.value && props.id === id) await go("next");
  });

  const undo = $(async () => {
    const u = notice.value?.undo;
    if (!u || busy.value) return;
    if (u.id === props.id && props.dirty) {
      notice.value = {
        tone: "error",
        text: "保存していない変更があります。先に保存してください。",
      };
      return;
    }
    busy.value = true;
    const result = await props.onVisibility$(u.id, u.visibility);
    busy.value = false;
    notice.value = result.ok
      ? { tone: "ok", text: `#${u.id} を元に戻しました` }
      : { tone: "error", text: `失敗しました: ${result.message}` };
  });

  useOnDocument(
    "keydown",
    $((e: Event) => {
      const ev = e as KeyboardEvent;
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const action = reviewKey(
        {
          key: ev.key,
          repeat: ev.repeat,
          isComposing: ev.isComposing,
          altKey: ev.altKey,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          targetTag: target?.tagName,
          targetType:
            target instanceof HTMLInputElement ? target.type : undefined,
          targetEditable: target?.isContentEditable,
        },
        open.value,
      );
      if (!action) return;
      if (action.type === "visibility") setVisibility(action.visibility);
      else go(action.type);
    }),
  );

  // Preload the neighbours while viewing, so stepping is instant: their
  // thumbnail (what the viewer shows first) and the overlay preset.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const isOpen = track(() => open.value);
    const base = track(() => props.imageBase);
    const files = track(() => [
      props.neighbors?.nextFile,
      props.neighbors?.prevFile,
    ]);
    if (!isOpen || !base) return;
    const preset = pickOverlayPreset(
      window.innerWidth * OVERLAY_BOX_WIDTH_RATIO,
      window.devicePixelRatio || 1,
    );
    // Not cancelled when the photo changes: stepping on usually lands on
    // the one being preloaded.
    for (const file of files) {
      if (!file) continue;
      // The thumbnail as an <img> loads it (same request, so cached)...
      const thumb = new Image();
      thumb.srcset = srcSet(base, file, LIST_CANDIDATES);
      thumb.src = imageUrl(base, file, "h240");
      // ...and the larger one as FullscreenImage fetches it (/thumb
      // varies on Accept, so the same kind of request hits the cache).
      fetch(imageUrl(base, file, preset))
        .then((r) => r.blob())
        .catch(() => {});
    }
  });
  // A message about unsaved edits belongs to the photo it was shown on.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => props.id);
    track(() => props.dirty);
    if (notice.value?.tone === "error") notice.value = null;
  });

  const { dir, base } = splitPath(props.file);
  const n = props.neighbors;
  const control =
    "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium text-white ring-1 ring-white/20 hover:bg-white/20 aria-disabled:opacity-30";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="写真を全画面で表示"
        aria-haspopup="dialog"
        onClick$={openViewer}
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
          shows the page behind, like the public gallery. A click outside
          the controls closes it, as there. */}
      <dialog
        ref={dialog}
        aria-label={`Preview of ${props.file}`}
        data-testid="fullscreen"
        onClick$={() => dialog.value?.close()}
        onClose$={() => {
          open.value = false;
          syncUrl(false);
          trigger.value?.focus();
        }}
        onTouchStart$={(e: TouchEvent) => {
          const t = e.touches[0];
          // Not a swipe: two fingers (pinch), panning a zoomed-in photo,
          // or starting at the screen's edge (the browser's own back).
          const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
          const edge = t.clientX < 24 || t.clientX > window.innerWidth - 24;
          touchStart.value =
            e.touches.length === 1 && !zoomed && !edge
              ? { x: t.clientX, y: t.clientY }
              : null;
        }}
        onTouchCancel$={() => (touchStart.value = null)}
        onTouchEnd$={(e: TouchEvent) => {
          const start = touchStart.value;
          touchStart.value = null;
          const t = e.changedTouches[0];
          if (!start || !t) return;
          const dir = swipe(t.clientX - start.x, t.clientY - start.y);
          if (dir) go(dir);
        }}
        class="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-transparent"
      >
        <div class={[overlayClass.backdrop, "px-3"]}>
          <div
            stoppropagation:click
            data-testid="viewer-info"
            class="flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white"
          >
            {n && (
              <span class="tabular-nums" data-testid="viewer-position">
                {n.pos} / {n.total}
              </span>
            )}
            <span class="min-w-0 truncate font-medium" title={props.file}>
              <span class="text-white/60">{dir}</span>
              {base}
            </span>
            {props.timestamp && (
              <span class="text-white/70 tabular-nums">
                {formatJst(props.timestamp)}
              </span>
            )}
            <span
              data-testid="viewer-visibility"
              class="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold"
            >
              {VISIBILITY_JA[props.visibility]}
            </span>
          </div>
          <FullscreenImage
            file={props.file}
            imageBase={props.imageBase}
            open={open.value}
            boxClass="max-h-[calc(100dvh-13rem)]"
          />
          <div
            stoppropagation:click
            class="flex w-full max-w-4xl flex-col items-center gap-2"
          >
            <div class="flex w-full items-center justify-center gap-2">
              <button
                type="button"
                aria-label="前の写真 (←)"
                // (aria-disabled so focus stays when the end is reached)
                aria-disabled={n?.prev ? undefined : "true"}
                onClick$={() => go("prev")}
                class={control}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <div
                role="group"
                aria-label="公開範囲"
                class="grid flex-1 grid-cols-3 gap-2 sm:max-w-md sm:flex-none"
              >
                {VISIBILITY_KEYS.map(([key, v]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={props.visibility === v}
                    aria-keyshortcuts={key}
                    // aria-disabled, not disabled: the pressed button
                    // keeps focus while saving (setVisibility ignores
                    // presses meanwhile).
                    aria-disabled={busy.value ? "true" : undefined}
                    onClick$={() => setVisibility(v)}
                    class={[
                      control,
                      "aria-pressed:bg-white aria-pressed:text-zinc-900",
                    ]}
                  >
                    {VISIBILITY_JA[v]}
                    <kbd class="hidden rounded border border-current/40 px-1 text-[10px] opacity-70 sm:inline">
                      {key}
                    </kbd>
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="次の写真 (→)"
                aria-disabled={n?.next ? undefined : "true"}
                onClick$={() => go("next")}
                class={control}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <div class="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/80">
              <label class="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoAdvance.value}
                  onChange$={(_, el) => {
                    autoAdvance.value = el.checked;
                    try {
                      localStorage.setItem(
                        AUTO_ADVANCE_KEY,
                        el.checked ? "1" : "0",
                      );
                    } catch {
                      // Storage blocked: for this page view only.
                    }
                  }}
                />
                設定したら次へ進む
              </label>
              <p
                role="status"
                aria-live="polite"
                data-testid="viewer-notice"
                class={[
                  "flex min-h-11 items-center gap-2",
                  notice.value?.tone === "error" && "text-red-300",
                ]}
              >
                {notice.value?.text ?? ""}
                {notice.value?.undo && (
                  <button
                    type="button"
                    onClick$={undo}
                    class="h-11 rounded-lg px-2 font-semibold text-sky-300 underline-offset-4 hover:underline"
                  >
                    元に戻す
                  </button>
                )}
              </p>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
});

type ImageProps = {
  file: string;
  imageBase: string | null;
  open: boolean;
  /** Extra classes for the photo box (its height next to the controls). */
  boxClass?: string;
};

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
      if (!open || fullSrc.value || !base) {
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
  if (!props.imageBase) {
    // Thumbnails off (E2E, previews): the file type, like Thumb's tile.
    return (
      <div class={[overlayClass.box, props.boxClass]}>
        <span class="text-sm font-semibold tracking-wider text-white/70">
          {fileExtension(props.file) || "IMG"}
        </span>
      </div>
    );
  }
  return (
    <>
      <div class={[overlayClass.box, props.boxClass]}>
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
    </>
  );
});
