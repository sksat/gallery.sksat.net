import { $, component$, Slot, useSignal } from "@builder.io/qwik";

import { HoverCard } from "./hover-card";
import {
  parseWorldCard,
  worldCardUrl,
  worldImageUrl,
  type WorldCard,
} from "./world-preview";

const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/** Each photo's card, fetched once per page. */
const cards = new Map<string, Promise<WorldCard | null>>();
const fetchCard = (photoId: string): Promise<WorldCard | null> => {
  let card = cards.get(photoId);
  if (!card) {
    card = fetch(worldCardUrl(photoId))
      .then((res) => (res.ok ? res.json() : null))
      .then(parseWorldCard)
      .catch(() => null);
    // Without a card, asked again next time (it may have been a moment's
    // failure).
    void card.then((c) => {
      if (c === null) cards.delete(photoId);
    });
    cards.set(photoId, card);
  }
  return card;
};

interface WorldLinkProps {
  photoId: string;
  name: string;
  href: string;
  /** The link's classes. */
  class: string;
}

/**
 * A photo's VRChat world link, with a card that previews the world (its
 * picture, name, author and description; hover-card.tsx). The card's data
 * is fetched on first showing, from the site's own API (which reads
 * vrchat.com itself), and its picture comes from the image Worker: the
 * browser never asks VRChat for anything until the link is followed.
 */
export const WorldLink = component$<WorldLinkProps>((props) => {
  /** undefined: not fetched yet; null: there is no preview. */
  const data = useSignal<WorldCard | null | undefined>(undefined);
  const wanted = useSignal(false);
  const image = worldImageUrl(IMAGE_BASE, props.photoId);

  const load = $(async () => {
    wanted.value = true;
    // Fetched the first time, and again after it failed (fetchCard keeps
    // only the cards it got).
    if (data.value === undefined || data.value === null) {
      data.value = undefined;
      data.value = await fetchCard(props.photoId);
    }
  });

  const d = data.value;
  return (
    <HoverCard
      id={`world-preview-${props.photoId}`}
      href={props.href}
      class={props.class}
      external
      toggleLabel="ワールドのプレビュー"
      testId="world-preview"
      empty={d === null}
      onShow$={load}
    >
      <Slot />
      {wanted.value && (
        <div q:slot="card">
          {image && (d === undefined || d?.image) && (
            <div class="aspect-[4/3] w-full bg-white/5">
              {d?.image && (
                <img
                  src={image}
                  alt=""
                  width={288}
                  height={216}
                  decoding="async"
                  // A picture that cannot be had leaves the place empty.
                  onError$={(_, img: HTMLImageElement) => {
                    img.style.visibility = "hidden";
                  }}
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
      )}
    </HoverCard>
  );
});
