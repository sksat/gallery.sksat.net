import type { RequestEventCommon } from "@builder.io/qwik-city";

// Reject state-mutating requests whose Origin doesn't match the server.
// Qwik City applies its own CSRF Origin check to POST but NOT to PATCH /
// DELETE (verified by E2E), so we enforce it ourselves for those methods.
// Returns true if the request should be rejected (and writes a 403).
const enforceSameOrigin = (ev: RequestEventCommon): boolean => {
  const method = ev.request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }
  const origin = ev.request.headers.get("origin");
  // Strict: a missing Origin header (curl-style request, malformed client)
  // also falls through to 403. Browsers always send Origin on cross-origin
  // fetch, so this only blocks non-browser callers; production traffic from
  // the admin panel itself always sets Origin to the page origin.
  if (origin && origin === ev.url.origin) {
    return false;
  }
  ev.json(403, { error: "cross-origin request rejected" });
  return true;
};

// Wrap an API handler so any thrown error becomes a JSON 500 with the message
// logged server-side and a generic body returned. Used by every onGet/onPatch/
// onPost in src/routes/api/* so a missing D1 binding or a parseTags failure
// surfaces as a structured error instead of an opaque framework 500.
//
// State-mutating requests (anything that isn't GET/HEAD/OPTIONS) get an
// Origin check first — Qwik City covers POST, but PATCH/DELETE need this
// guard. Cloudflare Access is the primary gate in production; this is
// defence-in-depth.
export const withErrorHandler = (
  label: string,
  handler: (ev: RequestEventCommon) => Promise<void>,
): ((ev: RequestEventCommon) => Promise<void>) => {
  return async (ev) => {
    if (enforceSameOrigin(ev)) return;
    try {
      await handler(ev);
    } catch (err) {
      // Server log carries the label + full error; the response body is
      // intentionally generic so a misconfigured Cloudflare Access policy
      // can't enumerate endpoint names by hitting them unauthenticated.
      console.error(`${label} failed:`, err);
      ev.json(500, { error: "internal server error" });
    }
  };
};
