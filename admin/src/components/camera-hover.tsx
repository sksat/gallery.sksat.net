import { $, component$, Slot, useSignal } from "@builder.io/qwik";
import { parseCameraPreview, type CameraPreview } from "~/lib/camera-preview";
import { HoverCard } from "./hover-card";
import { Thumb } from "./thumb";
import { muted } from "./ui";
import { usePlatformList } from "~/routes/layout";

/** Each camera's card, fetched once per page (a failure: asked again). */
const previews = new Map<number, Promise<CameraPreview | null>>();
const fetchPreview = (id: number): Promise<CameraPreview | null> => {
  let p = previews.get(id);
  if (!p) {
    p = fetch(`/api/camera/${id}/preview/`)
      .then((res) => (res.ok ? res.json() : null))
      .then(parseCameraPreview)
      .catch(() => null);
    void p.then((c) => {
      if (c === null) previews.delete(id);
    });
    previews.set(id, p);
  }
  return p;
};

/**
 * A link to a camera (the slot), with a card showing what the list row
 * does not: its first picture and its newest photos, over its name, kind
 * and counts. Its pictures are read on first showing
 * (GET /api/camera/<id>/preview, lib/camera-preview.ts).
 */
export const CameraHover = component$<{
  id: number;
  name: string;
  /** Its kind and counts, as one line under the name. */
  about: string;
  imageBase: string | null;
  /** The wrapper's classes. */
  class?: string;
}>((props) => {
  // Read on the server, so the list reaches the browser for the Thumbs
  // first rendered there (see admin CLAUDE.md, usePlatformList).
  usePlatformList().value;
  const data = useSignal<CameraPreview | null | undefined>(undefined);
  const wanted = useSignal(false);
  const load = $(async () => {
    wanted.value = true;
    if (data.value === undefined || data.value === null) {
      data.value = undefined;
      data.value = await fetchPreview(props.id);
    }
  });
  const d = data.value;
  return (
    <HoverCard
      testId="camera-preview"
      toggleLabel="カメラのプレビュー"
      onShow$={load}
      class={props.class}
    >
      <Slot />
      {wanted.value && (
        <div q:slot="card">
          {d?.picture && (
            <Thumb
              file={d.picture.file}
              platform={null}
              imageBase={props.imageBase}
              variant="list"
              exact={d.picture.exact}
              large
              class="w-full"
            />
          )}
          <div class="flex flex-col gap-1 p-3.5">
            <p class="leading-snug font-semibold">{props.name}</p>
            <p class={muted}>{props.about}</p>
            {d === undefined && (
              <div aria-hidden="true" class="mt-1 grid grid-cols-4 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    class="aspect-video rounded bg-zinc-200 dark:bg-zinc-700"
                  />
                ))}
              </div>
            )}
            {d && d.photos.length > 0 && (
              <ul
                aria-hidden="true"
                data-testid="camera-preview-photos"
                class="mt-2 grid grid-cols-4 gap-1"
              >
                {d.photos.map((p) => (
                  <li key={p.id}>
                    <Thumb
                      file={p.file}
                      platform={p.platform}
                      imageBase={props.imageBase}
                      variant="list"
                      class="w-full rounded"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </HoverCard>
  );
});
