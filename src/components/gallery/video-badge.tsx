import { component$ } from "@builder.io/qwik";
import { formatDuration } from "@shared/video/format";

/**
 * The mark on a video's tile: a play triangle and its length, so a video
 * reads as one before it is opened (the admin's tiles have the same).
 */
export const VideoBadge = component$<{ durationMs: number | null }>(
  ({ durationMs }) => (
    <span
      data-testid="video-badge"
      class="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        class="h-3 w-3"
        fill="currentColor"
      >
        <path d="M4 2.5v11l9-5.5z" />
      </svg>
      <span class="sr-only">動画</span>
      {durationMs !== null && <span>{formatDuration(durationMs)}</span>}
    </span>
  ),
);
