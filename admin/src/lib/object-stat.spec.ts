import { describe, expect, it, vi } from "vitest";
import { getObjectStat } from "./object-stat";

const LOCAL = new URL("http://127.0.0.1:5175/api/upload/1");
const PROD = new URL("https://admin.gallery.sksat.net/api/upload/1");

describe("getObjectStat", () => {
  it("asks the image Worker with the request's Access token", async () => {
    const stat = vi.fn(async () => ({
      ok: true as const,
      stat: { size: 5, etag: '"e"', sha256: "ab" },
    }));
    const fn = getObjectStat({ env: { IMAGES: { stat } } }, PROD, "jwt");
    expect(await fn?.("/a.png")).toEqual({ size: 5, sha256: "ab" });
    expect(stat).toHaveBeenCalledWith("jwt", "/a.png");
  });

  it("passes on a missing object and throws on a refusal", async () => {
    const missing = getObjectStat(
      { env: { IMAGES: { stat: async () => ({ ok: true, stat: null }) } } },
      PROD,
      "jwt",
    );
    expect(await missing?.("/a.png")).toBeNull();
    const refused = getObjectStat(
      { env: { IMAGES: { stat: async () => ({ ok: false, status: 403 }) } } },
      PROD,
      null,
    );
    await expect(refused?.("/a.png")).rejects.toThrow("403");
  });

  it("is null without the binding", () => {
    expect(getObjectStat({ env: {} }, PROD, "jwt")).toBeNull();
  });

  it("uses the E2E fake bucket on loopback only", async () => {
    const fetchFn = vi.fn(async () => Response.json({ size: 1, sha256: "x" }));
    const env = { E2E_FAKE_B2_STAT_URL: "http://127.0.0.1:5177/__stat" };
    const local = getObjectStat({ env }, LOCAL, null, fetchFn as never);
    expect(await local?.("/a b.png")).toEqual({ size: 1, sha256: "x" });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:5177/__stat?key=%2Fa%20b.png",
    );
    expect(getObjectStat({ env }, PROD, null, fetchFn as never)).toBeNull();
  });
});
