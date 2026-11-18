import type { Visibility } from "~/lib/types";
import { VISIBILITY_LABELS } from "./ui";
import { VISIBILITY_STYLE, VisibilityIcon } from "./visibility-style";

// Who can see a photo, at a glance: an icon and a label (never colour
// alone). Public stands out (filled); unlisted is outlined in amber;
// private is the quietest. The look is in visibility-style.tsx, shared
// with the edit page's choices, the selection bar and the viewer.

// A plain function component (not component$): it renders as part of its
// parent, so it follows the row when a bulk change or its undo updates it.
export const VisibilityBadge = ({
  visibility,
  compact,
  class: cls,
}: {
  visibility: Visibility;
  /** Icon only (tight spots); the label stays for screen readers. */
  compact?: boolean;
  class?: string;
}) => (
  <span
    data-testid="visibility-badge"
    data-visibility={visibility}
    title={compact ? VISIBILITY_LABELS[visibility] : undefined}
    class={[
      "inline-flex items-center gap-1 rounded-full text-xs font-medium ring-1 ring-inset",
      compact ? "p-1" : "px-2 py-0.5",
      VISIBILITY_STYLE[visibility].badge,
      cls,
    ]}
  >
    <VisibilityIcon visibility={visibility} class="size-3.5" />
    <span class={compact ? "sr-only" : undefined}>
      {VISIBILITY_LABELS[visibility]}
    </span>
  </span>
);
