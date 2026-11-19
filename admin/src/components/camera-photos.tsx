import { component$, useSignal, useTask$, type QRL } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { CameraPhoto } from "~/lib/db-photo-bulk";
import { formatJst } from "~/lib/format";
import { isVisibility } from "~/lib/types";
import { Thumb } from "./thumb";
import { buttonSecondary, card, muted } from "./ui";
import { VisibilityBadge } from "./visibility-badge";

// The camera page's 写真: every listed photo taken with the camera, as
// tiles like the Files view's (each opens the photo's edit page), with a
// tick box to pick some and カメラを外す for the picked ones (undo from the
// page's toast). The bar is fixed at the bottom on phones (replacing the
// tab bar), sticky at the viewport's bottom from sm.

type Props = {
  photos: CameraPhoto[];
  imageBase: string | null;
  busy: boolean;
  /** Takes the camera off these photos; true when it went through. */
  onRemove$: QRL<(ids: number[]) => Promise<boolean>>;
};

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const CameraPhotos = component$<Props>(
  ({ photos, imageBase, busy, onRemove$ }) => {
    const picked = useSignal<number[]>([]);
    // A reload (after a change or its undo): keep what is still listed.
    useTask$(({ track }) => {
      const ids = new Set(track(() => photos.map((p) => p.id)));
      if (picked.value.some((id) => !ids.has(id))) {
        picked.value = picked.value.filter((id) => ids.has(id));
      }
    });
    const pickedSet = new Set(picked.value);

    return (
      <section
        aria-labelledby="photos-heading"
        data-testid="camera-photos"
        class={[card, "space-y-4 p-5"]}
      >
        <h2
          id="photos-heading"
          class="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        >
          写真 <span class={["font-normal", muted]}>({photos.length})</span>
        </h2>
        {photos.length === 0 ? (
          <p class={["text-sm", muted]}>写真はまだありません</p>
        ) : (
          <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => {
              const name = nameOf(p.path);
              const on = pickedSet.has(p.id);
              return (
                <li
                  key={p.id}
                  data-testid="camera-photo"
                  class={[
                    "group relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
                    on && "ring-2 ring-sky-500",
                  ]}
                >
                  <label class="absolute top-0 right-0 z-10 flex size-11 cursor-pointer items-center justify-center sm:size-9">
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`${name} を選ぶ`}
                      onChange$={(_, el) => {
                        picked.value = el.checked
                          ? [...picked.value, p.id]
                          : picked.value.filter((id) => id !== p.id);
                      }}
                      class="size-5 accent-sky-600"
                    />
                  </label>
                  <Link
                    href={`/media/${p.id}/`}
                    prefetch="js"
                    title={p.path}
                    class="block"
                  >
                    <span class="relative block">
                      <Thumb
                        file={p.file}
                        platform={p.platform}
                        imageBase={imageBase}
                        variant="list"
                        class="w-full"
                      />
                      {isVisibility(p.visibility) && (
                        <VisibilityBadge
                          visibility={p.visibility}
                          compact
                          class="absolute top-1.5 left-1.5 shadow-sm"
                        />
                      )}
                    </span>
                    <span class="block truncate px-2 pt-1.5 text-xs font-medium">
                      {name}
                    </span>
                    <span
                      class={["block px-2 pb-1.5 text-xs tabular-nums", muted]}
                    >
                      {formatJst(p.timestamp) ?? "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {picked.value.length > 0 && (
          <div
            data-bottom-bar
            role="region"
            aria-label="選んだ写真"
            data-testid="camera-photos-bar"
            class={[
              "z-30 flex flex-wrap items-center gap-2 border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95",
              "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:border-t max-sm:pt-2 max-sm:pr-[max(1rem,env(safe-area-inset-right))] max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-sm:pl-[max(1rem,env(safe-area-inset-left))]",
              "sm:sticky sm:bottom-4 sm:rounded-xl sm:border sm:p-2 sm:shadow-lg",
            ]}
          >
            <p class="mr-auto text-sm font-semibold tabular-nums">
              {picked.value.length} 件選択
            </p>
            <button
              type="button"
              onClick$={() =>
                (picked.value =
                  picked.value.length < photos.length
                    ? photos.map((p) => p.id)
                    : [])
              }
              class={buttonSecondary}
            >
              {picked.value.length < photos.length ? "すべて選択" : "選択解除"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick$={async () => {
                if (await onRemove$(picked.value)) picked.value = [];
              }}
              class={[buttonSecondary, "text-red-700 dark:text-red-400"]}
            >
              カメラを外す
            </button>
          </div>
        )}
      </section>
    );
  },
);
