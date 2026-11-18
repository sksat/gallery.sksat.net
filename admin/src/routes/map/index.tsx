import { component$, useSignal } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";

import { groupPlaces } from "@shared/map/map";
import { AdminMap, type AdminPlace } from "~/components/admin-map";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { Thumb } from "~/components/thumb";
import { muted } from "~/components/ui";
import {
  VISIBILITY_LABELS_JA,
  VisibilityIcon,
} from "~/components/visibility-style";
import { getDB, getImageBase } from "~/lib/env";
import { formatPosition, listLocatedPhotos } from "~/lib/map";

type MapPage =
  | { kind: "ok"; places: AdminPlace[]; imageBase: string | null }
  | { kind: "missing-binding" };

/** /map/: every listed photo with a position, private ones too. */
export const useMapPage = routeLoader$<MapPage>(
  async ({ platform, status }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/map loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    const photos = await listLocatedPhotos(db);
    return {
      kind: "ok",
      places: groupPlaces(
        photos.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
          precision: "exact" as const,
          item: p,
        })),
      ),
      imageBase: getImageBase(platform),
    };
  },
);

export default component$(() => {
  const data = useMapPage();
  const focus = useSignal<{ key: string } | null>(null);
  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { places, imageBase } = data.value;
  const count = places.reduce((n, p) => n + p.items.length, 0);
  return (
    <div class="space-y-4">
      <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
        Map <span class={["font-normal", muted]}>({count})</span>
      </h1>
      {places.length === 0 ? (
        <StatePanel tone="empty" level={2} title="No photos with a position">
          <p>A photo shows here once its position is set on its edit page.</p>
        </StatePanel>
      ) : (
        <>
          <AdminMap places={places} imageBase={imageBase} focus={focus} />
          <ul class="space-y-3" aria-label="場所の一覧" data-testid="map-list">
            {places.map((place) => (
              <li
                key={place.key}
                data-testid="map-list-place"
                class="flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <button
                  type="button"
                  class="inline-flex h-11 items-center rounded-lg border border-zinc-300 px-3 text-sm tabular-nums hover:bg-zinc-50 sm:h-9 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  onClick$={() => {
                    focus.value = { key: place.key };
                    document
                      .querySelector("[data-testid=admin-map]")
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  {formatPosition(place.lat, place.lng)}
                  <span class={["ml-2", muted]}>{place.items.length} 枚</span>
                </button>
                <span class="flex flex-wrap gap-1">
                  {place.items.map((photo) => (
                    <Link
                      prefetch="js"
                      key={photo.id}
                      href={`/media/${photo.id}/`}
                      aria-label={`#${photo.id}（${VISIBILITY_LABELS_JA[photo.visibility]}）`}
                      class="relative block w-16 overflow-hidden rounded-md"
                    >
                      <Thumb
                        file={photo.file}
                        platform={photo.platform}
                        imageBase={imageBase}
                        variant="list"
                        class="w-16"
                      />
                      <span class="absolute right-0.5 bottom-0.5 rounded bg-white/90 p-px dark:bg-zinc-950/80">
                        <VisibilityIcon
                          visibility={photo.visibility}
                          class="size-3"
                        />
                      </span>
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
});

export const head: DocumentHead = { title: "Map — Admin" };
