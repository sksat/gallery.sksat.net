import type { RequestHandler } from "@builder.io/qwik-city";
import { withErrorHandler } from "~/lib/api";
import { getB2Env, getDB } from "~/lib/env";
import { publishMediaJson } from "~/lib/publish";

// CSRF: defence in depth.
//   (1) Qwik City rejects POSTs whose Origin header does not match the
//       server origin — verified for raw RequestHandler `onPost` (not
//       only `routeAction$`) by curl.
//   (2) `withErrorHandler` calls `enforceSameOrigin`, which independently
//       enforces the same rule for every state-mutating method (POST,
//       PATCH, DELETE) — Qwik's built-in only covers POST.
//   (3) Cloudflare Access fronts production.
// The `csrf-protection` E2E spec pins both POST and PATCH behaviour so a
// framework or wrapper change loosening either layer surfaces as a test
// failure rather than silently widening the attack surface.
//
// withErrorHandler also logs the full error (B2 endpoint, S3 body, etc.)
// to the worker logs and returns a generic message so credentials and
// infra details are not leaked through the response.
export const onPost: RequestHandler = withErrorHandler(
  "publish",
  async ({ platform, json }) => {
    const db = getDB(platform);
    const env = getB2Env(platform);
    const result = await publishMediaJson(db, env);
    json(200, result);
  },
);
