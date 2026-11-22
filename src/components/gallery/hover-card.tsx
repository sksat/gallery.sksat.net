import {
  $,
  component$,
  noSerialize,
  Slot,
  useSignal,
  type NoSerialize,
  type QRL,
} from "@builder.io/qwik";
import { cardPosition, HOVER_MS } from "@shared/preview/position";

/** Marks a link whose card is open, so Esc closes it before the overlay. */
export const OPEN_PREVIEW = "data-preview-open";

interface HoverCardProps {
  /** The card's id (the link's aria-describedby). */
  id: string;
  href: string;
  /** The link's classes. */
  class: string;
  /** Opens in a new tab (a page on another site). */
  external?: boolean;
  /** The touch screens' button: 「ワールドのプレビュー」. */
  toggleLabel: string;
  /** The card's test id; its button's is `<testId>-toggle`. */
  testId: string;
  /** There is nothing to show (the data could not be had). */
  empty?: boolean;
  /** The card is wanted: load what it shows. */
  onShow$?: QRL<() => void>;
}

/**
 * A link with a card that previews what it links to, while the pointer
 * rests on the link or the link has the focus; Esc hides it. On touch
 * screens, where nothing hovers, a small button beside the link shows and
 * hides it. The card is a popover in the top layer, so it covers what is
 * under it without moving anything and is never clipped by a scrolling
 * panel; it is placed under (or above) the link, and placed again when
 * its content changes size.
 *
 * The link's content is the default slot, the card's the "card" slot:
 * the caller renders it once `onShow$` was called, so nothing of it (its
 * pictures) loads before the card is wanted.
 */
export const HoverCard = component$<HoverCardProps>((props) => {
  const link = useSignal<HTMLAnchorElement>();
  const toggle = useSignal<HTMLButtonElement>();
  const card = useSignal<HTMLElement>();
  const open = useSignal(false);
  const timer = useSignal<number | null>(null);
  const observer = useSignal<NoSerialize<ResizeObserver>>();

  const place = $(() => {
    const el = card.value;
    const anchor = link.value;
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
    const el = card.value;
    if (el && typeof el.showPopover === "function") {
      if (!el.matches(":popover-open")) el.showPopover();
      // Placed now, and again whenever its content changes size (its data
      // or picture arriving).
      if (!observer.value) {
        const ro = new ResizeObserver(() => void place());
        ro.observe(el);
        observer.value = noSerialize(ro);
      }
      await place();
    }
    await props.onShow$?.();
  });
  const hide = $(() => {
    if (timer.value !== null) window.clearTimeout(timer.value);
    timer.value = null;
    open.value = false;
    observer.value?.disconnect();
    observer.value = undefined;
    const el = card.value;
    if (el?.matches(":popover-open")) el.hidePopover();
  });

  const shown = open.value && props.empty !== true;

  return (
    <>
      <a
        ref={link}
        href={props.href}
        target={props.external ? "_blank" : undefined}
        rel={props.external ? "noopener noreferrer" : undefined}
        class={props.class}
        aria-describedby={shown ? props.id : undefined}
        {...{ [OPEN_PREVIEW]: shown ? "" : undefined }}
        onPointerEnter$={(e: PointerEvent) => {
          if (e.pointerType === "touch") return;
          timer.value = window.setTimeout(() => void show(), HOVER_MS);
        }}
        onPointerLeave$={(e: PointerEvent) => {
          if (e.pointerType === "touch") return;
          void hide();
        }}
        onFocus$={show}
        onBlur$={hide}
        // Esc hides the card (wherever the focus is); a moment later, so
        // the overlay's own Esc (gallery.tsx) still sees it open and
        // leaves the photo open. On an element: see gallery.tsx on why
        // not useOnDocument.
        document:onKeyDown$={(e: KeyboardEvent) => {
          if (e.key === "Escape" && open.value) {
            window.setTimeout(() => void hide(), 0);
          }
        }}
      >
        <Slot />
      </a>
      {/* Touch screens: a button to show the card (nothing hovers). */}
      <button
        ref={toggle}
        type="button"
        data-testid={`${props.testId}-toggle`}
        aria-label={props.toggleLabel}
        aria-expanded={shown ? "true" : "false"}
        aria-controls={props.id}
        // Not a tap outside the photo (which closes the overlay).
        stoppropagation:click
        onClick$={() => (open.value ? hide() : show())}
        // A tap anywhere else hides it.
        document:onPointerDown$={(e: PointerEvent) => {
          const t = e.target as Node | null;
          if (
            open.value &&
            t &&
            !link.value?.contains(t) &&
            !toggle.value?.contains(t)
          ) {
            void hide();
          }
        }}
        class="ml-1.5 hidden size-7 items-center justify-center rounded-full align-middle text-white/70 ring-1 ring-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white [@media(hover:none)]:inline-flex"
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
      <div
        ref={card}
        id={props.id}
        role="tooltip"
        data-testid={props.testId}
        {...{ popover: "manual" }}
        // The top layer's own place: fixed, set by `place`. Nothing to
        // show (empty) keeps it out of sight while it is open.
        class={[
          "fixed [inset:auto] m-0 w-72 overflow-hidden rounded-xl border-0 bg-[#0c0f22] p-0 text-left text-white shadow-2xl ring-1 ring-white/15",
          props.empty && "!hidden",
        ]}
      >
        <Slot name="card" />
      </div>
    </>
  );
});
