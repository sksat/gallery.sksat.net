import { component$, Slot } from "@builder.io/qwik";

import { GRID_CANDIDATES, imageUrl, srcSet } from "./images";
import type { MediaIndex } from "./types";

const S3_BASE = import.meta.env.VITE_S3_BASE_URL;
const IMAGE_BASE = import.meta.env.VITE_IMAGE_BASE_URL;

/**
 * A camera page's photos digitised with it (スキャン機材), apart from the
 * photos taken with it: each links to its own page.
 */
export const DigitizedList = component$<{ media: MediaIndex }>(({ media }) =>
  media.length === 0 ? null : (
    <section
      aria-labelledby="camera-digitized"
      class="mt-8 px-2 sm:px-3"
      data-testid="digitized-list"
    >
      <SectionHeading id="camera-digitized">スキャンした写真</SectionHeading>
      <ul class="flex flex-wrap gap-1">
        {media.map((m) => (
          <li key={m.id}>
            <a href={`/photo/${m.id}/`} class="block">
              <img
                src={imageUrl(S3_BASE, m, IMAGE_BASE, "h240")}
                srcset={srcSet(S3_BASE, m, IMAGE_BASE, GRID_CANDIDATES)}
                alt={m.takenText ?? ""}
                height={120}
                class="h-30 w-auto"
                loading="lazy"
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  ),
);

/**
 * A section of a camera page below its profile: a rule, the title, and
 * room for a link at the right. (Its profile says how many.)
 */
export const SectionHeading = component$<{
  id: string;
  href?: string;
  linkText?: string;
}>(({ id, href, linkText }) => (
  <div class="mb-3 flex flex-wrap items-baseline gap-x-3 border-t border-white/15 px-1 pt-4">
    {/* "!": styles.css sizes every h2 for the site's banner. */}
    <h2 id={id} class="!text-lg !font-semibold">
      <Slot />
    </h2>
    {href && (
      // Plain <a>: see the note in components/layout/header.tsx.
      <a
        href={href}
        data-testid="camera-all-photos"
        class="ml-auto inline-flex min-h-11 items-center text-sm sm:min-h-8"
      >
        {linkText}
      </a>
    )}
  </div>
));
