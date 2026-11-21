// What a photo's public `og` card says now, asked of the image Worker
// (AdminImage.caption, which draws its caption from the API's answer), so
// the cards the admin's browser draws say exactly what the Worker would
// (src/lib/og-card.ts). The local E2E server binds E2E_FAKE_CAPTION_URL to
// the fake bucket instead (loopback only).

import { isLoopback } from "./access";
import { getAdminImages } from "./env";
import { parseCardCaption, type CaptionOf } from "./resized";

/** The caption reader for this request, or null with nothing to ask. */
export const getCaptionOf = (
  platform: { env?: Record<string, unknown> } | undefined,
  url: URL,
  accessJwt: string | null,
  fetchFn: typeof fetch = fetch,
): CaptionOf | null => {
  const fake = platform?.env?.E2E_FAKE_CAPTION_URL;
  if (typeof fake === "string" && fake && isLoopback(url.hostname)) {
    return async (publicId) => {
      const res = await fetchFn(
        `${fake}?${new URLSearchParams({ id: publicId })}`,
      );
      if (!res.ok) throw new Error(`fake caption: ${res.status}`);
      const body: unknown = await res.json();
      return body === null ? null : parseCardCaption(body);
    };
  }
  const images = getAdminImages(platform);
  if (!images) return null;
  return async (publicId) => {
    const res = await images.caption(accessJwt, publicId);
    if (!res.ok) throw new Error(`AdminImage.caption: ${res.status}`);
    return res.caption === null ? null : parseCardCaption(res.caption);
  };
};
