import { component$, useSignal } from "@builder.io/qwik";

import { CAMERA_KIND_LABELS } from "./cameras";
import { GRID_CANDIDATES, imageUrl, srcSet, type PresetName } from "./images";
import { PhotoOverlay } from "./photo-overlay";
import type { CameraImageJSON, CameraJSON } from "./types";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

// The main picture is at most 320 CSS px tall.
const MAIN_CANDIDATES: [PresetName, string][] = [
  ["h480", "1x"],
  ["w1200", "2x"],
];

const alt = (camera: CameraJSON, img: CameraImageJSON) =>
  img.caption ? `${camera.name}: ${img.caption}` : camera.name;

/**
 * Details of the camera a camera page (/camera/<slug>/) is about, shown
 * above its photos: pictures of the camera (the first large, the rest as a
 * strip; any of them opens in the photo overlay), kind, make/model,
 * description and product page. `camera` is null for an unknown slug.
 */
export const CameraHeader = component$<{
  slug: string;
  camera: CameraJSON | null;
  count: number;
}>(({ slug, camera, count }) => {
  const opened = useSignal<string | null>(null);

  if (!camera) {
    return (
      <section data-testid="camera-header" class="mb-4 px-1">
        {/* Plain <a>: see the note in components/layout/header.tsx. */}
        <a href="/" class="text-sm opacity-80 hover:opacity-100">
          ← すべての写真
        </a>
        <h1 class="mt-2 text-xl font-semibold">
          カメラ「{slug}」は見つかりません
        </h1>
      </section>
    );
  }

  const makeModel = [camera.make, camera.model].filter(Boolean).join(" ");
  const main = camera.images.at(0);
  const rest = camera.images.slice(1);

  return (
    <section
      data-testid="camera-header"
      aria-labelledby="camera-name"
      class="mb-4 flex flex-col gap-4 px-1 md:flex-row md:items-start"
    >
      {main && (
        <div class="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            data-testid="camera-image"
            class="block cursor-zoom-in overflow-hidden rounded"
            onClick$={() => (opened.value = main.file)}
          >
            <img
              src={imageUrl(S3_BASE, main.file, IMAGE_BASE, "h480")}
              srcset={srcSet(S3_BASE, main.file, IMAGE_BASE, MAIN_CANDIDATES)}
              alt={alt(camera, main)}
              // A fixed box (the picture is letterboxed in it), so the
              // details beside it do not shift when it loads.
              width={448}
              height={320}
              class="h-56 w-80 max-w-full object-contain object-left sm:h-80 sm:w-[28rem]"
            />
          </button>
          {rest.length > 0 && (
            <ul class="flex flex-wrap gap-2" aria-label="ほかの画像">
              {rest.map((img) => (
                <li key={img.file}>
                  <button
                    type="button"
                    data-testid="camera-image"
                    class="block cursor-zoom-in overflow-hidden rounded opacity-90 hover:opacity-100"
                    onClick$={() => (opened.value = img.file)}
                  >
                    <img
                      src={imageUrl(S3_BASE, img.file, IMAGE_BASE, "h240")}
                      srcset={srcSet(
                        S3_BASE,
                        img.file,
                        IMAGE_BASE,
                        GRID_CANDIDATES,
                      )}
                      alt={alt(camera, img)}
                      loading="lazy"
                      width={96}
                      height={64}
                      class="h-16 w-24 object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div class="min-w-0">
        {/* Plain <a>: see the note in components/layout/header.tsx. */}
        <a href="/" class="text-sm opacity-80 hover:opacity-100">
          ← すべての写真
        </a>
        <h1
          id="camera-name"
          class="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {camera.name}
        </h1>
        <dl class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {camera.kind && (
            <div class="flex gap-2">
              <dt class="opacity-60">種類</dt>
              <dd>{CAMERA_KIND_LABELS[camera.kind]}</dd>
            </div>
          )}
          {makeModel && makeModel !== camera.name && (
            <div class="flex gap-2">
              <dt class="opacity-60">機種</dt>
              <dd>{makeModel}</dd>
            </div>
          )}
          <div class="flex gap-2">
            <dt class="opacity-60">写真</dt>
            <dd class="tabular-nums">{count} 枚</dd>
          </div>
        </dl>
        {camera.description && (
          <p class="mt-3 max-w-3xl text-sm leading-relaxed whitespace-pre-line opacity-90">
            {camera.description}
          </p>
        )}
        {camera.productUrl && (
          <p class="mt-2 text-sm">
            <a
              href={camera.productUrl}
              rel="noopener noreferrer"
              target="_blank"
              class="underline-offset-4 hover:underline"
            >
              製品ページ<span aria-hidden="true"> ↗</span>
            </a>
          </p>
        )}
      </div>
      {opened.value && (
        <PhotoOverlay
          key={opened.value}
          file={opened.value}
          onClose$={() => (opened.value = null)}
        />
      )}
    </section>
  );
});
