import {
  $,
  component$,
  noSerialize,
  Slot,
  useId,
  useSignal,
  useTask$,
  type ClassList,
  type NoSerialize,
  type QRL,
} from "@builder.io/qwik";
import { cardPosition, HOVER_MS } from "@shared/preview/position";

interface HoverCardProps {
  /** The card's test id; its button's is `<testId>-toggle`. */
  testId: string;
  /** The touch screens' button (「ワールドのプレビュー」); none without. */
  toggleLabel?: string;
  /** There is nothing to show (the data could not be had). */
  empty?: boolean;
  /** The card is wanted: load what it shows. */
  onShow$?: QRL<() => void>;
  /** The wrapper's classes; inline-flex unless given. */
  class?: ClassList;
}

/**
 * A link (the default slot: an anchor or a Qwik City Link) with a card
 * that previews what it links to (the "card" slot), like the public
 * gallery's
 * (src/components/gallery/hover-card.tsx): while the pointer rests on the
 * link or it has the focus; Esc hides it. On touch screens, where nothing
 * hovers, a small button beside the link shows and hides it. The card is
 * a popover in the top layer, placed under (or above) the link, so it
 * moves nothing. The caller renders the card's content once `onShow$`
 * was called, so nothing of it loads before it is wanted.
 */
export const HoverCard = component$<HoverCardProps>((props) => {
  const wrap = useSignal<HTMLDivElement>();
  const toggle = useSignal<HTMLButtonElement>();
  const card = useSignal<HTMLElement>();
  const open = useSignal(false);
  const timer = useSignal<number | null>(null);
  const observer = useSignal<NoSerialize<ResizeObserver>>();
  // Removed while open (a page left): let it go.
  useTask$(({ cleanup }) => {
    cleanup(() => observer.value?.disconnect());
  });
  const uid = useId();
  const id = `preview-${uid}`;

  const link = $(() => wrap.value?.querySelector<HTMLElement>("a") ?? null);
  const place = $(async () => {
    const el = card.value;
    const anchor = (await link()) ?? wrap.value;
    if (!el || !anchor) return;
    const { top, left } = cardPosition(
      anchor.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });

  const show = $(async () => {
    if (timer.value !== null) window.clearTimeout(timer.value);
    timer.value = null;
    open.value = true;
    // The card describes the link (a Qwik City Link takes no ref of ours).
    (await link())?.setAttribute("aria-describedby", id);
    const el = card.value;
    if (el && typeof el.showPopover === "function") {
      if (!el.matches(":popover-open")) el.showPopover();
      if (!observer.value) {
        const ro = new ResizeObserver(() => void place());
        ro.observe(el);
        observer.value = noSerialize(ro);
      }
      await place();
    }
    await props.onShow$?.();
  });
  const hide = $(async () => {
    if (timer.value !== null) window.clearTimeout(timer.value);
    timer.value = null;
    open.value = false;
    (await link())?.removeAttribute("aria-describedby");
    observer.value?.disconnect();
    observer.value = undefined;
    const el = card.value;
    if (el?.matches(":popover-open")) el.hidePopover();
  });

  const shown = open.value && props.empty !== true;

  return (
    <div
      ref={wrap}
      class={props.class ?? "inline-flex items-center"}
      onPointerEnter$={(e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        timer.value = window.setTimeout(() => void show(), HOVER_MS);
      }}
      onPointerLeave$={(e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        void hide();
      }}
      onFocusIn$={(e: FocusEvent) => {
        // The link's focus; the button shows it on a tap.
        if (e.target !== toggle.value) void show();
      }}
      onFocusOut$={(e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !wrap.value?.contains(next)) void hide();
      }}
      document:onKeyDown$={(e: KeyboardEvent) => {
        if (e.key === "Escape" && open.value) void hide();
      }}
    >
      <Slot />
      {props.toggleLabel && (
        <button
          ref={toggle}
          type="button"
          data-testid={`${props.testId}-toggle`}
          aria-label={props.toggleLabel}
          aria-expanded={shown ? "true" : "false"}
          aria-controls={id}
          onClick$={() => (open.value ? hide() : show())}
          document:onPointerDown$={(e: PointerEvent) => {
            const t = e.target as Node | null;
            if (open.value && t && !wrap.value?.contains(t)) void hide();
          }}
          class="ml-1.5 hidden size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 ring-1 ring-zinc-300 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:text-zinc-100 [@media(hover:none)]:inline-flex"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
      <div
        ref={card}
        id={id}
        role="tooltip"
        data-testid={props.testId}
        {...{ popover: "manual" }}
        // The top layer's own place: fixed, set by `place`.
        class={[
          "fixed [inset:auto] m-0 w-72 overflow-hidden rounded-xl border-0 bg-white p-0 text-left text-sm text-zinc-900 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700",
          props.empty && "!hidden",
        ]}
      >
        <Slot name="card" />
      </div>
    </div>
  );
});
