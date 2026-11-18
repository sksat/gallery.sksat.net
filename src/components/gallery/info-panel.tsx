import {
  $,
  component$,
  sync$,
  useComputed$,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";

import { hasDetails, infoSummary, photoInfo } from "./photo-info";
import type { MediaInfo } from "./types";

/** Where the desktop open/closed choice is remembered. */
const STORAGE_KEY = "gallery.infoPanel";
/** Tailwind's `md`: a side panel from here up, a bottom sheet below. */
const DESKTOP_QUERY = "(min-width: 768px)";
/** How far (px) a swipe has to go to open or close the sheet. */
const SWIPE_PX = 30;

/** A click meant for a new tab or window. */
const isModified = (e: MouseEvent) =>
  e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;

const readStored = (): boolean | null => {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "open" ? true : v === "closed" ? false : null;
  } catch {
    return null;
  }
};

const store = (open: boolean) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Private mode or blocked storage: just not remembered.
  }
};

/**
 * Whether the panel starts open, in the browser: on desktops as last left
 * (open at first), on phones closed.
 */
export const initialOpen = (): boolean =>
  isDesktop() ? (readStored() ?? true) : false;

export type TagLink = { tag: string; href: string };

interface InfoPanelProps {
  photo: MediaInfo;
  /** Each tag of the photo with the gallery URL filtered by it. */
  tagLinks: TagLink[];
  /** Filter the gallery by a tag (and close the photo). */
  onTag$: QRL<(tag: string) => void>;
  /**
   * Open or closed; null until the browser decides (the breakpoint's
   * default). Owned by the overlay, which makes room for the panel.
   */
  open: Signal<boolean | null>;
}

/**
 * The photo's metadata in the overlay, exactly as the API gave it: a side
 * panel on desktops (open by default, remembered), a bottom sheet on
 * phones (closed by default, with a one-line summary on the photo).
 * Toggled with the ⓘ button or the `i` key.
 *
 * Rendered on the server (open on desktops, closed on phones, by CSS
 * alone) so /photo/<id> carries the metadata without JS. Every part takes
 * its own clicks, so the overlay's "click outside closes" never sees them.
 */
export const InfoPanel = component$<InfoPanelProps>((props) => {
  const open = props.open;
  const toggle = useSignal<HTMLButtonElement>();
  const closeButton = useSignal<HTMLButtonElement>();
  const touchY = useSignal<number | null>(null);

  const info = useComputed$(() => photoInfo(props.photo));

  // A visible task is intended: the viewport and localStorage are only
  // known in the browser.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    if (open.value === null) open.value = initialOpen();
  });

  const setOpen = $((value: boolean) => {
    open.value = value;
    if (isDesktop()) store(value);
  });

  const onKeyDown = $((event: KeyboardEvent) => {
    if (
      event.key !== "i" ||
      event.repeat ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const t = event.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement ||
      (t instanceof HTMLElement && t.isContentEditable)
    )
      return;
    setOpen(!(open.value ?? isDesktop()));
  });

  const onTouchStart = $((event: TouchEvent) => {
    touchY.value = event.touches.length > 0 ? event.touches[0].clientY : null;
  });

  // Swipe up opens, swipe down closes; a tap is a click.
  const onTouchEnd = $((event: TouchEvent) => {
    const start = touchY.value;
    touchY.value = null;
    if (start === null || event.changedTouches.length === 0) return;
    const end = event.changedTouches[0].clientY;
    if (end - start < -SWIPE_PX) setOpen(true);
    else if (end - start > SWIPE_PX) setOpen(false);
  });

  const closeAndRefocus = $(() => {
    setOpen(false);
    toggle.value?.focus();
  });

  // The sheet opened from the summary takes the focus (its close button),
  // once it is no longer inert.
  const openSheet = $(async () => {
    await setOpen(true);
    // The render that lifts `inert` may take a few frames.
    const focus = (frames: number) => {
      const el = closeButton.value;
      if (el && !el.closest("[inert]")) el.focus();
      else if (frames > 0) requestAnimationFrame(() => focus(frames - 1));
    };
    requestAnimationFrame(() => focus(30));
  });

  const i = info.value;
  if (!hasDetails(i) && i.tags.length === 0) return null;
  const summary = infoSummary(i);
  const state = open.value;

  return (
    <>
      {/* Toggle: next to the share button (bottom right). It is the first
          element, so it is what the visible task waits to see; it also
          carries the `i` key (on an element: see gallery.tsx on why not
          useOnDocument). */}
      <button
        ref={toggle}
        document:onKeyDown$={onKeyDown}
        type="button"
        data-testid="info-toggle"
        aria-label="情報"
        title="情報 (i)"
        aria-controls="photo-info"
        // A string: Qwik writes a boolean true as an empty attribute.
        aria-expanded={state === null ? undefined : state ? "true" : "false"}
        stoppropagation:click
        onClick$={() => setOpen(!(open.value ?? isDesktop()))}
        class={[
          "absolute right-[3.75rem] bottom-3 rounded-full p-2 hover:bg-black/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
          state
            ? "bg-white/90 text-black hover:bg-white hover:text-black"
            : "bg-black/50 text-white/80",
        ]}
      >
        {/* ⓘ */}
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>

      {/* Phones: the summary on the photo; a tap or swipe up opens. */}
      {summary && (
        <button
          type="button"
          data-testid="info-summary"
          aria-controls="photo-info"
          aria-expanded={state ? "true" : "false"}
          stoppropagation:click
          onClick$={openSheet}
          onTouchStart$={onTouchStart}
          onTouchEnd$={onTouchEnd}
          class={[
            "absolute bottom-3 left-3 max-w-[calc(100%-7.5rem)] truncate rounded-full bg-black/50 px-3 py-2 text-left text-sm text-white/90 md:hidden",
            state ? "invisible" : "",
          ]}
        >
          {summary}
        </button>
      )}

      <section
        id="photo-info"
        data-testid="info-panel"
        aria-labelledby="photo-info-title"
        stoppropagation:click
        inert={state === false}
        class={[
          "absolute z-10 overflow-y-auto text-sm text-white transition-[translate,opacity] duration-200 ease-out",
          // Phone: a bottom sheet.
          "inset-x-0 bottom-0 max-h-[60vh] rounded-t-2xl bg-neutral-900 px-4 pb-6 shadow-2xl",
          // Desktop: a card along the right edge, above the buttons.
          "md:inset-x-auto md:top-14 md:right-3 md:bottom-16 md:max-h-none md:w-72 md:rounded-xl md:bg-neutral-900/80 md:px-4 md:pb-4 md:ring-1 md:ring-white/10 md:backdrop-blur-md",
          state === null
            ? "translate-y-full md:translate-none"
            : state
              ? "translate-none"
              : "translate-y-full md:translate-x-[calc(100%+1rem)] md:translate-y-0 md:opacity-0",
        ]}
      >
        <div
          class="sticky top-0 -mx-4 flex items-center justify-between bg-inherit px-4 pt-2 pb-2 md:static md:bg-transparent md:pt-3"
          onTouchStart$={onTouchStart}
          onTouchEnd$={onTouchEnd}
        >
          {/* Drag handle (phones). */}
          <div
            aria-hidden="true"
            class="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/30 md:hidden"
          />
          <h2
            id="photo-info-title"
            class="mt-3 !text-base font-semibold md:mt-0"
          >
            情報
          </h2>
          <button
            type="button"
            ref={closeButton}
            data-testid="info-close"
            aria-label="閉じる"
            title="閉じる"
            onClick$={closeAndRefocus}
            class="mt-3 rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:mt-0"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <dl class="mt-2 grid gap-y-3 [&_dd]:break-words [&_dt]:text-xs [&_dt]:text-white/60">
          {i.taken && (
            <div data-testid="info-taken">
              <dt>撮影日時</dt>
              <dd>
                <time dateTime={i.taken.datetime}>{i.taken.text}</time>
              </dd>
            </div>
          )}
          {(i.camera || i.body || i.lens) && (
            <div data-testid="info-camera">
              <dt>カメラ</dt>
              {i.camera && (
                <dd>
                  {i.camera.href ? (
                    <a
                      href={i.camera.href}
                      class="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white"
                    >
                      {i.camera.label}
                    </a>
                  ) : (
                    i.camera.label
                  )}
                </dd>
              )}
              {i.body && <dd class="text-white/80">{i.body}</dd>}
              {i.lens && (
                <dd data-testid="info-lens" class="text-white/80">
                  {i.lens}
                </dd>
              )}
            </div>
          )}
          {i.exposure && (
            <div data-testid="info-exposure">
              <dt>撮影設定</dt>
              <dd class="tabular-nums">{i.exposure}</dd>
            </div>
          )}
          {i.world && (
            <div data-testid="info-world">
              <dt>ワールド</dt>
              <dd>
                {i.world.href ? (
                  <a
                    href={i.world.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white"
                  >
                    {i.world.name}
                  </a>
                ) : (
                  i.world.name
                )}
              </dd>
            </div>
          )}
          {i.location && (
            <div data-testid="info-location">
              <dt>場所</dt>
              <dd>
                <a
                  href={i.location.href}
                  class="text-white underline decoration-white/40 underline-offset-2 hover:decoration-white"
                >
                  地図
                </a>
              </dd>
            </div>
          )}
          {i.tags.length > 0 && (
            <div data-testid="info-tags">
              <dt>タグ</dt>
              <dd class="mt-1 flex flex-wrap gap-1.5">
                {props.tagLinks.map(({ tag, href }) => (
                  <a
                    key={tag}
                    href={href}
                    data-testid="info-tag"
                    // A plain click filters in place; a modified one (new
                    // tab or window) is left to the browser.
                    onClick$={[
                      // sync$ is serialized as source: no outside names.
                      sync$((e: MouseEvent) => {
                        if (
                          e.button === 0 &&
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.shiftKey &&
                          !e.altKey
                        )
                          e.preventDefault();
                      }),
                      $((event: MouseEvent) => {
                        if (!isModified(event)) props.onTag$(tag);
                      }),
                    ]}
                    class="rounded-full border border-white/30 px-2.5 py-0.5 text-white hover:border-white/70"
                  >
                    {tag}
                  </a>
                ))}
              </dd>
            </div>
          )}
          {i.file && (
            <div data-testid="info-file">
              <dt>ファイル名</dt>
              <dd class="font-mono text-xs text-white/80">{i.file}</dd>
            </div>
          )}
        </dl>
      </section>
    </>
  );
});
