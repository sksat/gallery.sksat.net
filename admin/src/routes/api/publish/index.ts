import type { RequestHandler } from "@builder.io/qwik-city";
import { getB2Env, getDB } from "~/lib/env";
import { publishMediaJson } from "~/lib/publish";

// CSRF: Qwik City rejects POSTs whose Origin header does not match the
// server origin (we observed this returns "CSRF check failed" before our
// handler runs). Combined with Cloudflare Access at the edge, no extra
// token is needed here.
export const onPost: RequestHandler = async ({ platform, json }) => {
  try {
    const db = getDB(platform);
    const env = getB2Env(platform);
    const result = await publishMediaJson(db, env);
    json(200, result);
  } catch (err) {
    // Log the full error server-side; the response is intentionally generic so
    // B2 endpoint URLs / bucket names / S3 error bodies aren't leaked through
    // the API even though it's behind Cloudflare Access.
    console.error("publish failed:", err);
    json(500, { error: "publish failed; see admin worker logs" });
  }
};
