import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

// Rendered when a route loader catches a `getDB` failure (no D1 binding
// in the current runtime — e.g. `pnpm dev` instead of `pnpm serve`, or a
// preview deployment, which deliberately has no D1; see wrangler.jsonc).
// The verbose error stays in the worker logs; the page shows a generic
// pointer.
export const MissingBindingError = component$<{ backHref: string }>(
  ({ backHref }) => (
    <div style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
      <p>
        <Link href={backHref}>← Back</Link>
      </p>
      <h1>Configuration error</h1>
      <p>
        D1 binding unavailable. Run <code>pnpm serve</code> (not{" "}
        <code>pnpm dev</code>) for a wrangler-backed local server. Preview
        deployments have no database by design; in production, check the worker
        logs.
      </p>
    </div>
  ),
);
