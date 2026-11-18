// How the admin checks what an upload put in the bucket. Its own B2 key has
// writeFiles + listFiles + deleteFiles but no readFiles (no HEAD), so
// production asks the image Worker, whose key can read, through the AdminImage entrypoint's `stat` (Access JWT
// checked there too). The local E2E server instead binds
// E2E_FAKE_B2_STAT_URL to the fake bucket (e2e/fake-b2.mjs), honoured only
// on loopback hostnames like ACCESS_DISABLED.

import { isLoopback } from "./access";
import type { ObjectStat } from "./db-upload";
import { getAdminImages } from "./env";

export type StatFn = (file: string) => Promise<ObjectStat | null>;

/** The stat function for this request, or null when none is available. */
export const getObjectStat = (
  platform: { env?: Record<string, unknown> } | undefined,
  url: URL,
  accessJwt: string | null,
  fetchFn: typeof fetch = fetch,
): StatFn | null => {
  const fake = platform?.env?.E2E_FAKE_B2_STAT_URL;
  if (typeof fake === "string" && fake && isLoopback(url.hostname)) {
    return async (file) => {
      const res = await fetchFn(`${fake}?key=${encodeURIComponent(file)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`fake stat: ${res.status}`);
      return (await res.json()) as ObjectStat;
    };
  }
  const images = getAdminImages(platform);
  if (!images) return null;
  return async (file) => {
    const res = await images.stat(accessJwt, file);
    if (!res.ok) throw new Error(`AdminImage.stat: ${res.status}`);
    return res.stat && { size: res.stat.size, sha256: res.stat.sha256 };
  };
};
