/**
 * The photo overlay's look, shared by the public gallery's overlay and the
 * admin's full-screen preview so both read the same: Tailwind class
 * strings (each app's CSS scans shared/ with `@source`).
 */
export const overlayClass = {
  /** Translucent, so the page stays visible behind the photo. */
  backdrop:
    "fixed inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm",
  /** The photo box: 90vw × 85vh (OVERLAY_BOX_WIDTH_RATIO). */
  box: "relative flex h-[85vh] w-[90vw] items-center justify-center",
  /** The thumbnail first, the larger image stacked on top of it. */
  image: "absolute inset-0 h-full w-full object-contain",
  /**
   * The progress bar under the photo: wide enough to read at a glance but
   * narrower than the photo box. Kept in the layout (transparent when done)
   * so the photo does not jump.
   */
  progress:
    "h-1 w-[min(60vw,48rem)] overflow-hidden rounded-full bg-white/20 transition-opacity duration-300",
  progressDone: "opacity-0",
  progressActive: "opacity-100",
  progressFill: "h-full rounded-full bg-white/80",
  /** Size unknown (no Content-Length). */
  progressIndeterminate: "w-1/3 animate-pulse",
  progressDeterminate: "transition-[width] duration-150",
} as const;
