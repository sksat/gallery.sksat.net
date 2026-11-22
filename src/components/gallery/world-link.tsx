import {
  $,
  component$,
  Slot,
  useSignal,
  useVisibleTask$,
} from "@builder.io/qwik";

import {
  cardPosition,
  parseWorldCard,
  worldCardUrl,
  worldImageUrl,
  type WorldCard,
} from "./world-preview";

const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/** How long the pointer rests on the link before the card shows (ms). */
const HOVER_MS = 300;

/** Each photo's card, fetched once per page. */
const cards = new Map<string, Promise<WorldCard | null>>();
const fetchCard = (photoId: string): Promise<WorldCard | null> => {
  let card = cards.get(photoId);
  if (!card) {
    card = fetch(worldCardUrl(photoId))
      .then((res) => (res.ok ? res.json() : null))
      .then(parseWorldCard)
      .catch(() => null);
    cards.set(photoId, card);
  }
  return card;
};

/** Marks an open card, so Esc closes it before the overlay (gallery.tsx). */
export const OPEN_PREVIEW = "data-world-preview-open";

interface WorldLinkProps {
  photoId: string;
  name: string;
  href: string;
  /** The link's classes. */
  class: string;
}

/**
 * A photo's VRChat world link, with a card that previews the world (its
 * picture, name, author and description) while the pointer rests on the
 * link or the link has the focus; Esc hides it. On touch screens, where
 * nothing hovers, a small button beside the link shows and hides it. The
 * card's data is fetched on first showing, from the site's own API (which
 * reads vrchat.com itself), and its picture comes from the image Worker:
 * the browser never asks VRChat for anything until the link is followed.
 * The card is a popover in the top layer, so it covers what is under it
 * without moving anything and is never clipped by a scrolling panel.
 */
export const WorldLink = component$<WorldLinkProps>((props) => {
  const link = useSignal<HTMLAnchorElement>();
  const toggle = useSignal<HTMLButtonElement>();
  const card = useSignal<HTMLElement>();
  const open = useSignal(false);
  /** undefined: not fetched yet; null: there is no preview. */
  const data = useSignal<WorldCard | null | undefined>(undefined);
  const timer = useSignal<number | null>(null);
  const id = `world-preview-${props.photoId}`;
  const image = worldImageUrl(IMAGE_BASE, props.photoId);

  const show = $(async () => {
    open.value = true;
    if (data.value === undefined) data.value = await fetchCard(props.photoId);
  });
  const hide = $(() => {
    if (timer.value !== null) window.clearTimeout(timer.value);
    timer.value = null;
    open.value = false;
  });

  // A visible task is intended: the popover and its place on screen are
  // only known in the browser, and follow `open` and the card's size.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const shown = track(() => open.value) && track(() => data.value) !== null;
    const el = card.value;
    const anchor = link.value;
    if (!el || !anchor || typeof el.showPopover !== "function") return;
    if (!shown) {
      if (el.matches(":popover-open")) el.hidePopover();
      return;
    }
    if (!el.matches(":popover-open")) el.showPopover();
    const r = anchor.getBoundingClientRect();
    const { top, left } = cardPosition(
      r,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });

  const d = data.value;
  const shown = open.value && d !== null;

  return (
    <>
      <a
        ref={link}
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        class={props.class}
        aria-describedby={shown ? id : undefined}
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
        data-testid="world-preview-toggle"
        aria-label="ワールドのプレビュー"
        aria-expanded={shown ? "true" : "false"}
        aria-controls={id}
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
        id={id}
        role="tooltip"
        data-testid="world-preview"
        {...{ popover: "manual" }}
        // The top layer's own place: fixed, set by the task above.
        class="fixed [inset:auto] m-0 w-72 overflow-hidden rounded-xl border-0 bg-[#0c0f22] p-0 text-left text-white shadow-2xl ring-1 ring-white/15"
      >
        {image && (d === undefined || d?.image) && (
          <div class="aspect-[4/3] w-full bg-white/5">
            {d?.image && (
              <img
                src={image}
                alt=""
                width={288}
                height={216}
                decoding="async"
                class="h-full w-full object-cover"
              />
            )}
          </div>
        )}
        <div class="flex flex-col gap-1 p-3.5">
          <p class="text-[0.9375rem] leading-snug font-semibold">
            {d?.name ?? props.name}
          </p>
          {d?.author && <p class="text-sm text-white/60">by {d.author}</p>}
          {d?.description && (
            <p class="mt-1 line-clamp-4 text-sm leading-relaxed whitespace-pre-line text-white/80">
              {d.description}
            </p>
          )}
          {d === undefined && (
            <div aria-hidden="true" class="mt-1 flex flex-col gap-1.5">
              <div class="h-3 w-24 rounded bg-white/10" />
              <div class="h-3 w-full rounded bg-white/10" />
            </div>
          )}
        </div>
      </div>
    </>
  );
});
