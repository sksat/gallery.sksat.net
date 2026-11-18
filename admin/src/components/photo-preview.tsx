import {
  $,
  component$,
  useOnDocument,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import { useLocation, useNavigate } from "@builder.io/qwik-city";
import { overlayClass } from "@shared/overlay/styles";
import { splitPath } from "~/lib/format";
import { LIST_CANDIDATES, imageUrl, srcSet } from "~/lib/images";
import type { Neighbors } from "~/lib/neighbors";
import { OVERLAY_BOX_WIDTH_RATIO, pickOverlayPreset } from "~/lib/progress";
import {
  VISIBILITY_KEYS,
  canStartSwipe,
  reviewKey,
  swipe,
  withViewer,
  withoutViewer,
} from "~/lib/review-keys";
import {
  exposing,
  previewOf,
  parsePending,
  pendingCounts,
  pendingKey,
  togglePending,
  type Pending,
} from "~/lib/review-pending";
import { VISIBILITIES, type MediaPlatform, type Visibility } from "~/lib/types";
import { FullscreenImage } from "./fullscreen-image";
import { Thumb } from "./thumb";
import {
  VISIBILITY_LABELS_JA as VISIBILITY_JA,
  VISIBILITY_STYLE,
  VisibilityIcon,
} from "./visibility-style";

export type UndoChange = { id: number; from: Visibility; to: Visibility };

export type ApplyResult =
  | { ok: true; undo: UndoChange[] }
  | { ok: false; message: string; undo?: UndoChange[] };

type Props = {
  id: number;
  file: string;
  platform: MediaPlatform;
  timestamp: string | null;
  visibility: Visibility;
  /** /thumb base, or null for placeholders. */
  imageBase: string | null;
  /** Previous / next in the list the page was opened from. */
  neighbors: Neighbors | null;
  /** That list: pending choices are kept per list. */
  listHref: string;
  /** The page's form has unsaved edits (反映 reloads the page's data). */
  dirty: boolean;
  /** A save (or move / trash) of this photo is running. */
  saving?: boolean;
  /** Mirrors the number of pending choices (the page's leave guard). */
  pendingCount: Signal<number>;
  /** 反映: apply the pending choices; returns what undo needs. */
  onApply$: QRL<
    (changes: { id: number; visibility: Visibility }[]) => Promise<ApplyResult>
  >;
  onUndo$: QRL<(changes: UndoChange[]) => Promise<ApplyResult>>;
};

/** How long a choice shows before the viewer moves on. */
const CHOSEN_MS = 300;

type Notice = { text: string; tone: "ok" | "error"; undo?: UndoChange[] };

/**
 * The edit page's photo: the inline preview, and a tap on it opens a
 * full-screen viewer (the public gallery overlay's look, shared/overlay/)
 * for going through photos and deciding who sees them.
 *
 * ←/→, a swipe or ‹ › step through the list the page was opened from
 * (`?fs=1` keeps the viewer open, also on reload). 1/2/3 or the buttons
 * only mark a photo's new visibility (a pending choice, kept in
 * sessionStorage for the list) and move on; the bar applies them all at
 * once (反映), after a look at the photos that become visible to others,
 * with 元に戻す for the whole batch.
 */
export const PhotoPreview = component$<Props>((props) => {
  const dialog = useSignal<HTMLDialogElement>();
  const trigger = useSignal<HTMLButtonElement>();
  const open = useSignal(false);
  const busy = useSignal(false);
  const pending = useSignal<Pending>({});
  /** The choice just made: shown for a beat before moving on. */
  const chosen = useSignal<Visibility | null>(null);
  const notice = useSignal<Notice | null>(null);
  /** The 反映 step that shows what becomes visible, before applying. */
  const confirming = useSignal(false);
  const touchStart = useSignal<{ x: number; y: number } | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const boxClass =
    "w-full rounded-xl border border-zinc-200 dark:border-zinc-800";

  const store = $((next: Pending) => {
    pending.value = next;
    props.pendingCount.value = Object.keys(next).length;
    try {
      const key = pendingKey(props.listHref);
      if (Object.keys(next).length) {
        sessionStorage.setItem(key, JSON.stringify(next));
      } else {
        sessionStorage.removeItem(key);
      }
    } catch {
      // Storage blocked: kept for this page view only.
    }
  });

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

  // The list's pending choices (from earlier photos or a reload), and
  // ?fs=1 (a reload, or stepping through photos).
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track }) => {
      const list = track(() => props.listHref);
      try {
        const stored = parsePending(sessionStorage.getItem(pendingKey(list)));
        pending.value = stored;
        props.pendingCount.value = Object.keys(stored).length;
      } catch {
        // Storage blocked.
      }
      if (track(() => loc.url.searchParams.get("fs")) === "1") openViewer();
    },
    { strategy: "document-ready" },
  );

  /** Previous / next photo; in the viewer, stay in it. */
  const go = $(async (dir: "prev" | "next") => {
    // Not while 反映 is saving: its reload would finish after the
    // navigation and bring the page back to this photo.
    // Nor while the page saves this photo, for the same reason.
    if (busy.value || props.saving) return;
    const href = props.neighbors?.[dir];
    if (!href) return;
    if (open.value) {
      await nav(withViewer(href), { replaceState: true, scroll: false });
    } else {
      await nav(href);
    }
  });

  // A horizontal swipe steps like ←/→: on the viewer, and on the page's
  // photo (only there, so the form scrolls and works as usual).
  const swipeStart = $((e: TouchEvent) => {
    const t = e.touches[0];
    // Not a swipe: two fingers (pinch), panning a zoomed-in photo, or
    // starting at the screen's edge (the browser's own back).
    touchStart.value = canStartSwipe({
      fingers: e.touches.length,
      x: t.clientX,
      width: window.innerWidth,
      scale: window.visualViewport?.scale ?? 1,
    })
      ? { x: t.clientX, y: t.clientY }
      : null;
  });
  const swipeEnd = $((e: TouchEvent) => {
    const start = touchStart.value;
    touchStart.value = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dir = swipe(t.clientX - start.x, t.clientY - start.y);
    if (dir) go(dir);
  });

  /** Mark (or unmark) this photo's new visibility, then move on. */
  const mark = $(async (choice: Visibility) => {
    if (busy.value || chosen.value) return;
    const id = props.id;
    // Never for a photo other than the one on screen.
    if (!location.pathname.startsWith(`/media/${id}/`)) return;
    const next = togglePending(
      pending.value,
      id,
      choice,
      props.visibility,
      props.file,
    );
    await store(next);
    confirming.value = false;
    if (!next[id]) return; // Cleared: stay on this photo.
    chosen.value = choice;
    await new Promise((r) => setTimeout(r, CHOSEN_MS));
    chosen.value = null;
    if (open.value && props.id === id) await go("next");
  });

  const apply = $(async () => {
    if (busy.value) return;
    const entries = Object.entries(pending.value);
    if (!entries.length) return;
    if (props.dirty) {
      notice.value = {
        tone: "error",
        text: "保存していない変更があります。先に保存してください。",
      };
      return;
    }
    busy.value = true;
    let result: ApplyResult;
    try {
      result = await props.onApply$(
        entries.map(([id, item]) => ({ id: Number(id), visibility: item.to })),
      );
    } catch (err) {
      result = { ok: false, message: String(err) };
    } finally {
      busy.value = false;
    }
    confirming.value = false;
    if (!result.ok) {
      // The choices stay (applying again is harmless); what did go through
      // can still be undone.
      notice.value = {
        tone: "error",
        text: `失敗しました: ${result.message}`,
        undo: result.undo?.length ? result.undo : undefined,
      };
      return;
    }
    await store({});
    notice.value = {
      tone: "ok",
      text: `${entries.length} 件を反映しました`,
      undo: result.undo.length ? result.undo : undefined,
    };
  });

  /** 反映: a look at what becomes visible first; private needs none. */
  const startApply = $(() => {
    if (busy.value) return;
    if (exposing(pending.value).length) confirming.value = true;
    else return apply();
  });

  const undo = $(async () => {
    const u = notice.value?.undo;
    if (!u || busy.value) return;
    if (props.dirty) {
      notice.value = {
        tone: "error",
        text: "保存していない変更があります。先に保存してください。",
        undo: u,
      };
      return;
    }
    busy.value = true;
    let result: ApplyResult;
    try {
      result = await props.onUndo$(u);
    } catch (err) {
      result = { ok: false, message: String(err) };
    } finally {
      busy.value = false;
    }
    notice.value = result.ok
      ? { tone: "ok", text: "元に戻しました" }
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
      // Once per key press: after a client-side navigation Qwik can hold
      // this listener twice, and a second mark would undo the first.
      if (!action || ev.defaultPrevented) return;
      ev.preventDefault();
      if (action.type === "visibility") mark(action.visibility);
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

  const { base } = splitPath(props.file);
  const n = props.neighbors;
  const marked = pending.value[props.id]?.to;
  const shown = chosen.value ?? marked ?? props.visibility;
  const control =
    "inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium whitespace-nowrap aria-disabled:opacity-30 sm:gap-1.5 sm:px-3";
  const neutral = "bg-white/10 ring-1 ring-white/20 hover:bg-white/20";

  const bar = (
    <PendingBar
      pending={pending.value}
      imageBase={props.imageBase}
      confirming={confirming.value}
      busy={busy.value}
      notice={notice.value}
      onApply$={startApply}
      onConfirm$={apply}
      onCancel$={() => (confirming.value = false)}
      onDiscard$={() => {
        if (busy.value) return;
        confirming.value = false;
        return store({});
      }}
      onUndo$={undo}
    />
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="写真を全画面で表示"
        aria-haspopup="dialog"
        onClick$={openViewer}
        onTouchStart$={swipeStart}
        onTouchCancel$={() => (touchStart.value = null)}
        onTouchEnd$={swipeEnd}
        class="block w-full cursor-zoom-in rounded-xl"
      >
        <Thumb
          file={props.file}
          platform={props.platform}
          imageBase={props.imageBase}
          variant="preview"
          class={boxClass}
        />
      </button>
      {/* On the page: the same bar, while the viewer is closed. */}
      {!open.value && (
        <div class="fixed inset-x-3 bottom-[calc(var(--bottom-ui,0px)+0.75rem+env(safe-area-inset-bottom))] z-30 flex justify-center sm:inset-x-auto sm:top-16 sm:right-4 sm:bottom-auto">
          {bar}
        </div>
      )}
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
          confirming.value = false;
          syncUrl(false);
          // The browser gives focus back to the photo itself; only if it
          // could not (that button was gone). This handler can run late,
          // after focus has moved on.
          const active = document.activeElement;
          if (!active || active === document.body) trigger.value?.focus();
        }}
        onTouchStart$={swipeStart}
        onTouchCancel$={() => (touchStart.value = null)}
        onTouchEnd$={swipeEnd}
        class="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-transparent"
      >
        <div class={[overlayClass.backdrop, "px-3"]}>
          <div
            stoppropagation:click
            data-testid="viewer-info"
            class="flex w-full max-w-4xl items-center gap-2 text-sm text-white"
          >
            {n && (
              // At the end of the list: a check instead of a next step.
              <span
                data-testid="viewer-position"
                data-end={n.next ? undefined : ""}
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 tabular-nums data-end:bg-white data-end:text-zinc-900"
              >
                {n.pos} / {n.total}
                {!n.next && (
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    role="img"
                    aria-label="最後の写真"
                    class="size-3.5"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
                    />
                  </svg>
                )}
              </span>
            )}
            <span class="min-w-0 truncate font-medium" title={props.file}>
              {base}
            </span>
            {/* Saved, and the pending change if any: 🔒 非公開 → 🌐 公開. */}
            <span class="ml-auto flex shrink-0 items-center gap-1">
              <span
                data-testid="viewer-visibility"
                class={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
                  VISIBILITY_STYLE[props.visibility].badge,
                  marked && "opacity-60",
                ]}
              >
                <VisibilityIcon
                  visibility={props.visibility}
                  class="size-3.5"
                />
                {VISIBILITY_JA[props.visibility]}
              </span>
              {marked && (
                <span
                  data-testid="viewer-pending"
                  class={[
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold outline-2 outline-offset-1 outline-white outline-dashed",
                    VISIBILITY_STYLE[marked].badge,
                  ]}
                >
                  <span aria-hidden="true">→</span>
                  <VisibilityIcon visibility={marked} class="size-3.5" />
                  <span class="sr-only">変更予定:</span>
                  {VISIBILITY_JA[marked]}
                </span>
              )}
            </span>
          </div>
          <FullscreenImage
            file={props.file}
            imageBase={props.imageBase}
            open={open.value}
            boxClass="max-h-[calc(100dvh-14rem)]"
          />
          <div
            stoppropagation:click
            class="flex w-full max-w-4xl flex-col items-center gap-2"
          >
            {/* Phones: the bar right above the buttons, in thumb reach;
                larger screens: at the top right. */}
            {open.value && (
              <div class="flex w-full justify-center sm:fixed sm:top-3 sm:right-3 sm:w-auto">
                {bar}
              </div>
            )}
            <div class="flex w-full items-center justify-center gap-2">
              <button
                type="button"
                aria-label="前の写真 (←)"
                // (aria-disabled so focus stays when the end is reached)
                aria-disabled={n?.prev ? undefined : "true"}
                onClick$={() => go("prev")}
                class={[control, neutral, "text-xl text-white"]}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <div
                role="group"
                aria-label="公開範囲"
                class="grid flex-1 grid-cols-3 gap-2 sm:max-w-md sm:flex-none"
              >
                {VISIBILITY_KEYS.map(([key, v]) => {
                  // The photo's visibility as it will be (the pending
                  // choice, else the saved one) in its level's filled
                  // style; the others neutral with their icon and colour.
                  const on = shown === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      aria-keyshortcuts={key}
                      onClick$={() => mark(v)}
                      class={[
                        control,
                        "transition duration-150 motion-reduce:transition-none",
                        on
                          ? [VISIBILITY_STYLE[v].selected, "ring-2"]
                          : [neutral, VISIBILITY_STYLE[v].onDark],
                        on &&
                          marked === v &&
                          "outline-2 outline-offset-2 outline-white outline-dashed",
                        chosen.value === v && "motion-safe:scale-105",
                      ]}
                    >
                      <VisibilityIcon visibility={v} />
                      <span class={on ? undefined : "text-white"}>
                        {VISIBILITY_JA[v]}
                      </span>
                      {/* The key, for devices with a keyboard. */}
                      <kbd class="hidden rounded border border-current/40 px-1 text-[10px] leading-4 opacity-80 pointer-fine:inline">
                        {key}
                      </kbd>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                aria-label="次の写真 (→)"
                aria-disabled={n?.next ? undefined : "true"}
                onClick$={() => go("next")}
                class={[control, neutral, "text-xl text-white"]}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
});

type BarProps = {
  pending: Pending;
  imageBase: string | null;
  confirming: boolean;
  busy: boolean;
  notice: Notice | null;
  onApply$: QRL<() => void>;
  onConfirm$: QRL<() => void>;
  onCancel$: QRL<() => void>;
  onDiscard$: QRL<() => void>;
  onUndo$: QRL<() => void>;
};

/**
 * The pending choices by level (🌐 12 · 🔗 3 · 🔒 20) with 反映 and 破棄;
 * in the 反映 step, the photos that become visible to others as
 * thumbnails before applying; afterwards, the result with 元に戻す.
 */
const PendingBar = component$<BarProps>((props) => {
  const counts = pendingCounts(props.pending);
  const total = Object.keys(props.pending).length;
  const preview = previewOf(exposing(props.pending));
  // A result shows until the next choice; an error always.
  const notice =
    props.notice && (props.notice.tone === "error" || total === 0)
      ? props.notice
      : null;
  if (!total && !notice) return null;
  const pill =
    "flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-zinc-900/90 p-1.5 pl-3 text-sm text-white shadow-lg ring-1 ring-white/15 backdrop-blur";
  const action =
    "inline-flex h-11 items-center justify-center gap-1 rounded-xl px-3 font-semibold";

  return (
    <div
      role="region"
      aria-label="公開範囲の変更"
      data-testid="pending-bar"
      // A width of its own (not the content's): however many photos there
      // are, the buttons below stay on screen.
      class="flex max-w-[min(36rem,calc(100vw-1.5rem))] flex-col items-stretch gap-2"
    >
      {props.confirming && (
        <div
          data-testid="pending-confirm"
          // Rows that scroll within a height of their own; past
          // PREVIEW_MAX photos a "+N" says how many more.
          // (Its width follows the bar's: compact for a few photos, the
          // bar's max-width for many.)
          class="flex max-h-[min(13rem,30dvh)] flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain rounded-2xl bg-zinc-900/90 p-1.5 ring-1 ring-white/15"
        >
          {preview.shown.map(([id, item]) => (
            <span key={id} class="relative shrink-0">
              <Thumb
                file={item.file}
                platform={null}
                imageBase={props.imageBase}
                variant="list"
                class="h-14 rounded-lg"
              />
              <span
                class={[
                  "absolute right-1 bottom-1 rounded-full p-0.5 ring-1 ring-inset",
                  VISIBILITY_STYLE[item.to].badge,
                ]}
              >
                <VisibilityIcon visibility={item.to} class="size-3" />
                <span class="sr-only">{VISIBILITY_JA[item.to]}</span>
              </span>
            </span>
          ))}
          {preview.more > 0 && (
            <span
              data-testid="pending-confirm-more"
              class="flex h-14 items-center rounded-lg bg-white/10 px-3 text-sm font-semibold text-white tabular-nums"
            >
              <span class="sr-only">ほか </span>+{preview.more}
              <span class="sr-only"> 枚</span>
            </span>
          )}
        </div>
      )}
      {total > 0 ? (
        <div class={pill}>
          {/* The riskiest first: 🌐 · 🔗 · 🔒. */}
          <span class="flex items-center gap-2" data-testid="pending-counts">
            {[...VISIBILITIES]
              .reverse()
              .filter((v) => counts[v] > 0)
              .map((v) => (
                <span
                  key={v}
                  class={[
                    "inline-flex items-center gap-1 tabular-nums",
                    VISIBILITY_STYLE[v].onDark,
                  ]}
                >
                  <VisibilityIcon visibility={v} />
                  <span class="sr-only">{VISIBILITY_JA[v]}</span>
                  <span class="text-white">{counts[v]}</span>
                </span>
              ))}
          </span>
          {props.confirming ? (
            <>
              <button
                type="button"
                onClick$={props.onCancel$}
                class={[action, "text-white/80 hover:bg-white/10"]}
              >
                戻る
              </button>
              <button
                type="button"
                aria-disabled={props.busy ? "true" : undefined}
                onClick$={props.onConfirm$}
                class={[action, "bg-sky-500 text-zinc-950"]}
              >
                反映
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-disabled={props.busy ? "true" : undefined}
                onClick$={props.onDiscard$}
                class={[action, "text-white/80 hover:bg-white/10"]}
              >
                破棄
              </button>
              <button
                type="button"
                aria-disabled={props.busy ? "true" : undefined}
                onClick$={props.onApply$}
                class={[action, "bg-white text-zinc-900"]}
              >
                反映
              </button>
            </>
          )}
        </div>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        data-testid="pending-notice"
        class={[
          "flex items-center justify-center gap-2 rounded-full px-3 text-sm empty:hidden",
          notice?.tone === "error"
            ? "bg-red-950/90 text-red-200"
            : "bg-zinc-900/90 text-white",
        ]}
      >
        {notice?.text ?? ""}
        {notice?.undo && (
          <button
            type="button"
            onClick$={props.onUndo$}
            class="h-11 rounded-lg px-1 font-semibold text-sky-300 underline-offset-4 hover:underline"
          >
            元に戻す
          </button>
        )}
      </p>
    </div>
  );
});
