import { expect, test } from "@playwright/test";

// Pins Qwik City's framework-level Origin check for raw `onPost` handlers.
// /api/publish is the only state-mutating endpoint not gated by Cloudflare
// Access in dev, and we rely on the framework's CSRF protection there.
// If a Qwik upgrade ever loosens this default, this test surfaces it.
test("CSRF: POST /api/publish is rejected without a same-origin header", async ({
  request,
  baseURL,
}) => {
  // No Origin header at all (curl-style request).
  const noOrigin = await request.fetch(`${baseURL}/api/publish/`, {
    method: "POST",
  });
  expect(noOrigin.status()).toBe(403);

  // Explicit cross-origin Origin header.
  const crossOrigin = await request.fetch(`${baseURL}/api/publish/`, {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  expect(crossOrigin.status()).toBe(403);
});
