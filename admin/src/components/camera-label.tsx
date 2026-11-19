// A photo's camera (its `camera.name`) where photos are listed: over the
// foot of a Files view tile's thumbnail, or as a quiet badge beside the
// list's platform and visibility badges. Only the shooting camera: a
// digitised photo's スキャン機材 is not the camera it was taken with, so a
// photo with only that shows nothing. Long names are cut with an ellipsis
// (the whole name in `title`).

/** A small camera (20×20, filled). */
export const CameraGlyph = ({ class: cls }: { class?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class={["shrink-0", cls ?? "size-3.5"]}
  >
    <path
      fill-rule="evenodd"
      d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.66-.89l.82-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.66.89l.82 1.22a2 2 0 0 0 1.66.89H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
      clip-rule="evenodd"
    />
  </svg>
);

// Plain function components (not component$), like VisibilityBadge: they
// render as part of their row, so a bulk camera change shows at once.

/** Over the bottom of a thumbnail (its box `relative`), on a shade. */
export const CameraOverlay = ({ name }: { name: string | null }) =>
  name ? (
    <span
      data-testid="camera-label"
      title={name}
      class="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-black/70 via-black/40 to-transparent px-2 pt-5 pb-1 text-xs font-medium text-white"
    >
      <CameraGlyph class="size-3.5 opacity-90" />
      <span class="sr-only">カメラ: </span>
      <span class="min-w-0 truncate">{name}</span>
    </span>
  ) : null;

/** A badge in the same shape as PlatformBadge / VisibilityBadge. */
export const CameraBadge = ({ name }: { name: string | null }) =>
  name ? (
    <span
      data-testid="camera-label"
      title={name}
      class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 ring-inset dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"
    >
      <CameraGlyph />
      <span class="sr-only">カメラ: </span>
      <span class="min-w-0 truncate">{name}</span>
    </span>
  ) : null;
