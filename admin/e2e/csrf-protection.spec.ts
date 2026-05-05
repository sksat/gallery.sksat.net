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

test("PATCH /api/media/[id]: returns 404 for unknown id", async ({
  request,
  baseURL,
}) => {
  const res = await request.fetch(`${baseURL}/api/media/99999/`, {
    method: "PATCH",
    headers: {
      origin: baseURL ?? "",
      "content-type": "application/json",
    },
    data: JSON.stringify({ tags: ["x"] }),
  });
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body).toEqual({ error: "not found" });
});
