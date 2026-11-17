import type { RequestHandler } from "@builder.io/qwik-city";
import { checkAccess } from "~/lib/access";

// Runs before every SSR page, API handler, routeLoader/action and server$
// call (Qwik City runs plugin@ handlers first; `send` stops the chain).
// See src/lib/access.ts for why this exists even though Cloudflare Access
// fronts the custom domain.
//
// NOTE: the Cloudflare Pages adapter answers from the edge cache
// (`caches.match`) BEFORE Qwik City runs. Nothing here sets Cache-Control
// today; if you ever add `cacheControl` to an authenticated page, cached
// responses would bypass this check.
export const onRequest: RequestHandler = async ({
  request,
  platform,
  send,
}) => {
  const result = await checkAccess({
    url: new URL(request.url),
    headers: request.headers,
    env: (platform as { env?: Record<string, unknown> } | undefined)?.env ?? {},
    dev: import.meta.env.DEV,
  });
  if (!result.ok) {
    // Log the reason server-side only; the response stays generic.
    console.error(`[access] ${result.status} ${request.url}: ${result.reason}`);
    send(
      result.status,
      result.status === 403 ? "Forbidden" : "Service unavailable",
    );
  }
};
