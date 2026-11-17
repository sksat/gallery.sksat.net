import { expect, test } from "@playwright/test";

// Proves the Cloudflare Access JWT check (src/routes/plugin@access.ts) is
// wired into the request pipeline. The functional E2E server runs with
// ACCESS_DISABLED=1; e2e/start-test-server.sh also starts this server on
// PORT+1 without the bypass, which must reject anything lacking a valid
// Cf-Access-Jwt-Assertion (as the unprotected *.pages.dev hostname would).
const port = (Number(process.env.ADMIN_E2E_PORT) || 5175) + 1;
const base = `http://127.0.0.1:${port}`;

test.beforeAll(async ({ request }) => {
  // The no-bypass server is not Playwright's readiness URL; wait for it.
  await expect
    .poll(
      async () =>
        (await request.get(`${base}/`).catch(() => null))?.status() ?? 0,
      { timeout: 60_000 },
    )
    .not.toBe(0);
});

for (const path of ["/", "/media/", "/api/media/"]) {
  test(`Access: GET ${path} without a token is 403`, async ({ request }) => {
    const res = await request.get(`${base}${path}`);
    expect(res.status()).toBe(403);
  });
}

test("Access: a forged token is 403", async ({ request }) => {
  const res = await request.get(`${base}/api/media/`, {
    headers: { "cf-access-jwt-assertion": "eyJhbGciOiJub25lIn0.e30." },
  });
  expect(res.status()).toBe(403);
});

test("Access: same-origin POST /api/publish without a token is 403", async ({
  request,
}) => {
  const res = await request.post(`${base}/api/publish/`, {
    headers: { origin: base },
  });
  expect(res.status()).toBe(403);
});
