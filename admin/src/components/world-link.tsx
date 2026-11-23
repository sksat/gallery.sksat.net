import { $, component$, useSignal } from "@builder.io/qwik";
import { worldUrl } from "~/lib/photo-data";
import {
  parseWorldCard,
  worldCardPath,
  worldImagePath,
  type WorldCard,
} from "~/lib/world-preview";
import { HoverCard } from "./hover-card";
import { link, muted } from "./ui";

/** Each world's card, fetched once per page (a failure: asked again). */
const cards = new Map<string, Promise<WorldCard | null>>();
const fetchCard = (worldId: string): Promise<WorldCard | null> => {
  let card = cards.get(worldId);
  if (!card) {
    card = fetch(worldCardPath(worldId))
      .then((res) => (res.ok ? res.json() : null))
      .then(parseWorldCard)
      .catch(() => null);
    void card.then((c) => {
      if (c === null) cards.delete(worldId);
    });
    cards.set(worldId, card);
  }
  return card;
};

/**
 * The edit page's VRChat world link, with a card previewing the world
 * (its picture, name, author and description) like the public gallery's,
 * read through the admin's own /api/world/<id> (lib/world-preview.ts), so
 * the browser never asks VRChat until the link is followed. Without
 * `pictures` (thumbnails off: E2E, VRT) the card has no picture.
 */
export const WorldLink = component$<{
  worldId: string;
  name: string | null;
  pictures: boolean;
}>((props) => {
  const data = useSignal<WorldCard | null | undefined>(undefined);
  const wanted = useSignal(false);
  const load = $(async () => {
    wanted.value = true;
    if (data.value === undefined || data.value === null) {
      data.value = undefined;
      data.value = await fetchCard(props.worldId);
    }
  });
  const d = data.value;
  return (
    <HoverCard
      testId="world-preview"
      toggleLabel="ワールドのプレビュー"
      empty={d === null}
      onShow$={load}
    >
      <a
        href={worldUrl(props.worldId)}
        target="_blank"
        rel="noopener noreferrer"
        class={link}
        data-testid="world-link"
      >
        {props.name ?? props.worldId}
      </a>
      {wanted.value && (
        <div q:slot="card">
          {props.pictures && (d === undefined || d?.image) && (
            <div class="aspect-[4/3] w-full bg-zinc-100 dark:bg-zinc-800">
              {d?.image && (
                <img
                  src={worldImagePath(props.worldId)}
                  alt=""
                  width={288}
                  height={216}
                  decoding="async"
                  onError$={(_, img: HTMLImageElement) => {
                    img.style.visibility = "hidden";
                  }}
                  class="h-full w-full object-cover"
                />
              )}
            </div>
          )}
          <div class="flex flex-col gap-1 p-3.5">
            <p class="leading-snug font-semibold">
              {d?.name ?? props.name ?? props.worldId}
            </p>
            {d?.author && <p class={muted}>by {d.author}</p>}
            {d?.description && (
              <p class="mt-1 line-clamp-4 leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
                {d.description}
              </p>
            )}
            {d === undefined && (
              <div aria-hidden="true" class="mt-1 flex flex-col gap-1.5">
                <div class="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div class="h-3 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
              </div>
            )}
          </div>
        </div>
      )}
    </HoverCard>
  );
});
