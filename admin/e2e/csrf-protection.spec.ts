import { expect, test } from "@playwright/test";

// Pins the Origin check on state-mutating API requests (src/lib/api.ts),
// which Cloudflare Access does not cover in dev.
test("CSRF: PATCH /api/media/[id] is rejected without a same-origin header", async ({
  request,
  baseURL,
}) => {
  // No Origin header at all (curl-style request).
  const noOrigin = await request.fetch(`${baseURL}/api/media/1/`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ tags: ["x"] }),
  });
  expect(noOrigin.status()).toBe(403);
});

test("CSRF: PATCH /api/media/[id] is rejected from a cross-origin caller", async ({
  request,
  baseURL,
}) => {
  // An explicit cross-origin Origin header is rejected too.
  const crossOrigin = await request.fetch(`${baseURL}/api/media/1/`, {
    method: "PATCH",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    data: JSON.stringify({ tags: ["x"] }),
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

test("PATCH /api/media/[id]: returns 400 for non-integer id", async ({
  request,
  baseURL,
}) => {
  const res = await request.fetch(`${baseURL}/api/media/abc/`, {
    method: "PATCH",
    headers: {
      origin: baseURL ?? "",
      "content-type": "application/json",
    },
    data: JSON.stringify({ tags: ["x"] }),
  });
  expect(res.status()).toBe(400);
});

test("GET /api/media/[id]: returns 400 for id=0", async ({
  request,
  baseURL,
}) => {
  const res = await request.fetch(`${baseURL}/api/media/0/`);
  expect(res.status()).toBe(400);
});
