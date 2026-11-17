import { component$ } from "@builder.io/qwik";

import { Manufacturer } from "./camera-header";
import { CAMERA_KIND_LABELS, cameraHref, type CameraSummary } from "./cameras";
import { GRID_CANDIDATES, imageUrl, srcSet } from "./images";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/**
 * One camera on the list page. The whole card links to the camera page
 * (a stretched link on the name); the manufacturer's website link sits
 * above it, since links cannot nest.
 */
export const CameraCard = component$<{ summary: CameraSummary }>(
  ({ summary: { camera, count, cover } }) => (
    <li
      data-testid="camera-card"
      class="relative overflow-hidden rounded border border-white/15 transition-colors hover:border-white/50"
    >
      <div class="aspect-[4/3] bg-white/5">
        {cover && (
          <img
            src={imageUrl(S3_BASE, cover, IMAGE_BASE, "h240")}
            srcset={srcSet(S3_BASE, cover, IMAGE_BASE, GRID_CANDIDATES)}
            alt=""
            width={320}
            height={240}
            loading="lazy"
            decoding="async"
            class="h-full w-full object-cover"
          />
        )}
      </div>
      <div class="flex flex-col gap-1 p-3 text-sm">
        {/* Plain <a>: see the note in components/layout/header.tsx. */}
        <a
          href={cameraHref(camera.slug)}
          class="text-base font-semibold text-[var(--color-text)] after:absolute after:inset-0 after:content-['']"
        >
          {camera.name}
        </a>
        {camera.manufacturer && (
          // Only a link needs to sit above the card's stretched link.
          <span
            class={[
              "w-fit opacity-80",
              camera.manufacturerUrl && "relative z-10",
            ]}
          >
            <Manufacturer camera={camera} />
          </span>
        )}
        <span class="flex gap-3 opacity-70">
          {camera.kind && <span>{CAMERA_KIND_LABELS[camera.kind]}</span>}
          <span class="tabular-nums">{count} 枚</span>
        </span>
      </div>
    </li>
  ),
);
