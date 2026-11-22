import {
  $,
  component$,
  createContextId,
  Slot,
  useContext,
  useId,
  useSignal,
  type Signal,
} from "@builder.io/qwik";

import {
  CAMERA_KIND_LABELS,
  cameraSlugFromPath,
  type CameraPreview,
} from "./cameras";
import { HoverCard } from "./hover-card";
import { imageUrl } from "./images";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/**
 * Every listed camera's card, by slug (cameraPreviews), from the page that
 * has the photo and camera lists (Gallery, PhotoDetail). Without it, a
 * camera link is a plain link.
 */
export const CAMERA_PREVIEWS = createContextId<
  Signal<Record<string, CameraPreview>>
>("gallery.camera-previews");

interface CameraLinkProps {
  /** The camera's page, /camera/<slug>/. */
  href: string;
  /** The link's classes. */
  class: string;
}

/**
 * A link to a camera's page, with a card that previews the camera
 * (hover-card.tsx): its picture, name, maker and kind, how many photos it
 * has and its newest ones. All of it from the lists the page already has,
 * so showing it asks for nothing but the pictures (at the grid's preset).
 */
export const CameraLink = component$<CameraLinkProps>((props) => {
  const previews = useContext(CAMERA_PREVIEWS, null);
  const wanted = useSignal(false);
  const uid = useId();
  const id = `camera-preview-${uid}`;
  const show = $(() => {
    wanted.value = true;
  });

  const slug = cameraSlugFromPath(props.href);
  const p = slug === null ? undefined : previews?.value[slug];
  if (!p) {
    return (
      <a href={props.href} class={props.class}>
        <Slot />
      </a>
    );
  }
  const about = [
    p.manufacturer,
    p.kind ? CAMERA_KIND_LABELS[p.kind] : null,
  ].filter(Boolean);
  return (
    <HoverCard
      id={id}
      href={props.href}
      class={props.class}
      toggleLabel="カメラのプレビュー"
      testId="camera-preview"
      onShow$={show}
    >
      <Slot />
      {wanted.value && (
        <div q:slot="card">
          {p.picture && (
            <div class="aspect-[4/3] w-full bg-white/5">
              <img
                src={imageUrl(S3_BASE, p.picture, IMAGE_BASE, "h240")}
                alt=""
                width={288}
                height={216}
                decoding="async"
                class="h-full w-full object-cover"
              />
            </div>
          )}
          <div class="flex flex-col gap-1 p-3.5">
            <p class="text-[0.9375rem] leading-snug font-semibold">{p.name}</p>
            {about.length > 0 && (
              <p class="text-sm text-white/60">{about.join(" · ")}</p>
            )}
            <p class="text-sm text-white/60 tabular-nums">{p.count} 枚</p>
            {p.recent.length > 0 && (
              <ul
                aria-hidden="true"
                data-testid="camera-preview-photos"
                class="mt-2 grid grid-cols-4 gap-1 overflow-hidden rounded-md"
              >
                {p.recent.map((r) => (
                  <li key={r.id} class="aspect-square bg-white/5">
                    <img
                      src={imageUrl(S3_BASE, r, IMAGE_BASE, "h240")}
                      alt=""
                      width={64}
                      height={64}
                      decoding="async"
                      class="h-full w-full object-cover"
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
