import { component$ } from "@builder.io/qwik";
import { StatePanel } from "./state-panel";

// Rendered when a route loader catches a `getDB` failure (no D1 binding
// in the current runtime — e.g. `pnpm dev` instead of `pnpm serve`, or a
// preview deployment, which deliberately has no D1; see wrangler.jsonc).
// The verbose error stays in the worker logs; the page shows a generic
// pointer.
export const MissingBindingError = component$<{ backHref: string }>(
  ({ backHref }) => (
    <StatePanel
      tone="error"
      title="Configuration error"
      action={{ href: backHref, label: "← Back" }}
    >
      <p>The D1 database binding is unavailable in this runtime.</p>
      <p class="mt-2">
        Locally, run <code>pnpm serve</code> (not <code>pnpm dev</code>) for a
        wrangler-backed server. Preview deployments have no database by design;
        in production, check the worker logs.
      </p>
    </StatePanel>
  ),
);
