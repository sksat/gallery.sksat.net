// How the admin reads a few bytes of an original (metadata backfill): its
// own B2 key cannot read, so it asks the image Worker's AdminImage.bytes
// (Access JWT checked there too), like object-stat.ts does for uploads.
// The local E2E server binds E2E_FAKE_B2_BYTES_URL to the fake bucket
// instead (loopback only, like E2E_FAKE_B2_STAT_URL).

import { isLoopback } from "./access";
import type { ReadBytes } from "./backfill";
import { getAdminImages } from "./env";

/** The reader for this request, or null when there is nothing to read with. */
export const getObjectBytes = (
  platform: { env?: Record<string, unknown> } | undefined,
  url: URL,
  accessJwt: string | null,
  fetchFn: typeof fetch = fetch,
): ReadBytes | null => {
  const fake = platform?.env?.E2E_FAKE_B2_BYTES_URL;
  if (typeof fake === "string" && fake && isLoopback(url.hostname)) {
    return async (file, range) => {
      const q = new URLSearchParams({ key: file });
      if ("suffix" in range) q.set("suffix", String(range.suffix));
      else {
        q.set("offset", String(range.offset));
        q.set("length", String(range.length));
      }
      const res = await fetchFn(`${fake}?${q}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`fake bytes: ${res.status}`);
      const size = Number(res.headers.get("x-object-size"));
      return { bytes: new Uint8Array(await res.arrayBuffer()), size };
    };
  }
  const images = getAdminImages(platform);
  if (!images) return null;
  return async (file, range) => {
    const res = await images.bytes(accessJwt, file, range);
    // A path the Worker does not serve (an old name outside its rules):
    // nothing to read, like a missing object.
    if (!res.ok && res.status === 404) return null;
    if (!res.ok) throw new Error(`AdminImage.bytes: ${res.status}`);
    return res.object;
  };
};
