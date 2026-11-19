import { component$ } from "@builder.io/qwik";

import { GRID_CANDIDATES, imageUrl, srcSet } from "./images";
import type { MediaIndex } from "./types";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/**
 * A camera page's photos digitised with it (スキャン機材), apart from the
 * gallery of the photos taken with it: each links to its own page.
 */
export const DigitizedList = component$<{ media: MediaIndex }>(({ media }) =>
  media.length === 0 ? null : (
    <section class="mx-auto max-w-7xl px-4 py-6" data-testid="digitized-list">
      <h2 class="mb-3 text-sm text-white/70">スキャンした写真</h2>
      <ul class="flex flex-wrap gap-2">
        {media.map((m) => (
          <li key={m.id}>
            <a href={`/photo/${m.id}/`} class="block">
              <img
                src={imageUrl(S3_BASE, m, IMAGE_BASE, "h240")}
                srcset={srcSet(S3_BASE, m, IMAGE_BASE, GRID_CANDIDATES)}
                alt={m.takenText ?? ""}
                height={120}
                class="h-30 w-auto rounded"
                loading="lazy"
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  ),
);
