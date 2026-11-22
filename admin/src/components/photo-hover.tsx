import {
  $,
  component$,
  Slot,
  useSignal,
  type ClassList,
} from "@builder.io/qwik";
import type { MediaPlatform } from "~/lib/types";
import { HoverCard } from "./hover-card";
import { Thumb } from "./thumb";
import { usePlatformList } from "~/routes/layout";

/**
 * A link to a photo that names it only by text (前へ / 次へ), with a card
 * showing the photo's thumbnail (the list's, so usually already cached)
 * while the pointer rests on it or it has the focus. No button on touch
 * screens: there the photo is a swipe away.
 */
export const PhotoHover = component$<{
  file: string | null;
  platform: MediaPlatform | null;
  imageBase: string | null;
  testId: string;
  /** The wrapper's classes (its place in a flex row). */
  class?: ClassList;
}>((props) => {
  // Read on the server, so the list reaches the browser for the Thumb
  // first rendered there (see admin CLAUDE.md, usePlatformList).
  usePlatformList().value;
  const wanted = useSignal(false);
  const show = $(() => {
    wanted.value = true;
  });
  return (
    <HoverCard
      testId={props.testId}
      empty={props.file === null}
      onShow$={show}
      class={props.class}
    >
      <Slot />
      {wanted.value && props.file !== null && (
        <div q:slot="card">
          <Thumb
            file={props.file}
            platform={props.platform}
            imageBase={props.imageBase}
            variant="list"
            class="w-full"
          />
        </div>
      )}
    </HoverCard>
  );
});
