import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getB2Env, getDB } from "~/lib/env";
import { publishMediaJson } from "~/lib/publish";

// CSRF: Qwik City rejects POSTs whose Origin header does not match the
// server origin — verified for raw RequestHandler `onPost` (not only
// `routeAction$`) by curl: a missing or cross-origin POST returns 403
// before this handler runs. The `csrf-protection` E2E spec pins this
// behaviour so a framework upgrade that drops the default would surface
// as a test failure rather than silently widening the attack surface.
// Combined with Cloudflare Access at the edge, no extra token is needed.
//
// withErrorHandler logs the full error (B2 endpoint, S3 body, etc.) to the
// worker logs and returns a generic message so credentials and infra details
// are not leaked through the response.
export const onPost: RequestHandler = withErrorHandler(
  "publish",
  async ({ platform, json }) => {
    const db = getDB(platform);
    const env = getB2Env(platform);
    const result = await publishMediaJson(db, env);
    json(200, result);
  },
);
