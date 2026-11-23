import type { RequestHandler } from "@builder.io/qwik-city";
import { isLoopback } from "~/lib/access";
import { withErrorHandler } from "~/lib/api";
import { cacheKeyUrl, defaultCache } from "~/lib/cf-graphql";
import { faviconResponse } from "~/lib/favicon";

/**
 * GET /api/favicon/<host>/ — a referrer site's favicon (lib/favicon.ts),
 * or a grey globe when it has none we can use. 400 for a host that is not
 * a public DNS name. Kept in the Cache API for days (misses for an hour).
 *
 * The local E2E server binds E2E_FAKE_FAVICON_URL to a fake on loopback,
 * which then answers every request instead of the site (loopback only,
 * like the other fakes).
 */
export const onGet: RequestHandler = withErrorHandler(
  "GET /api/favicon",
  async ({ params, platform, url, send }) => {
    const host = params.host.toLowerCase();
    const fake = platform?.env?.E2E_FAKE_FAVICON_URL;
    let target: ((u: URL) => string) | undefined;
    if (typeof fake === "string" && fake && isLoopback(url.hostname)) {
      const base = new URL(fake);
      if (isLoopback(base.hostname)) {
        target = (u) => `${base.href}${u.hostname}${u.pathname}${u.search}`;
      }
    }
    send(
      await faviconResponse(host, {
        fetch,
        target,
        cache: target ? null : defaultCache(),
        key: cacheKeyUrl("favicon", host),
      }),
    );
  },
);
