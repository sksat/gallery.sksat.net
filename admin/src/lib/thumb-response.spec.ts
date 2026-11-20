import { describe, expect, it } from "vitest";
import { FALLBACK_HEADER, thumbHeaders } from "./thumb-response";

const upstream = (status: number, headers: Record<string, string>) =>
  new Response(status === 200 ? "x" : null, { status, headers });

describe("thumbHeaders", () => {
  it("keeps a resized image for an hour, with its type only", () => {
    const h = thumbHeaders(
      upstream(200, {
        "Content-Type": "image/avif",
        "Content-Length": "1",
        "Cf-Resized": "internal=ok",
      }),
    );
    expect(Object.fromEntries(h)).toEqual({
      "cache-control": "private, max-age=3600",
      "content-type": "image/avif",
      vary: "Accept",
      "x-content-type-options": "nosniff",
    });
  });

  it("passes the fallback on, briefly cached and with its length", () => {
    const h = thumbHeaders(
      upstream(200, {
        "Content-Type": "image/png",
        "Content-Length": "37000000",
        [FALLBACK_HEADER]: "original",
        "x-amz-meta-sha256": "ab",
      }),
    );
    expect(Object.fromEntries(h)).toEqual({
      "cache-control": "private, max-age=300",
      "content-type": "image/png",
      "content-length": "37000000",
      vary: "Accept",
      "x-content-type-options": "nosniff",
      "x-image-fallback": "original",
    });
  });

  it("caches no error", () => {
    const h = thumbHeaders(
      upstream(502, { "Content-Type": "text/plain", [FALLBACK_HEADER]: "x" }),
    );
    expect(Object.fromEntries(h)).toEqual({
      "cache-control": "no-store",
      vary: "Accept",
      "x-content-type-options": "nosniff",
    });
  });
});
