/**
 * Fetching a VRChat world's picture from VRChat's file servers, for the
 * image Worker's /img/world/<public_id> and the admin's
 * /api/world/<id>/image: redirects followed by hand and checked to stay
 * on those servers, the body capped.
 */
import { IMAGE_HOSTS, VRCHAT_USER_AGENT } from "./world";

/** Where the pictures may come from (and be redirected to). */
export const WORLD_IMAGE_HOSTS = IMAGE_HOSTS;

/** The largest picture passed on (bytes); VRChat's are about 0.5 MB. */
export const WORLD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** How long VRChat's file server has to answer, redirects and all (ms). */
const FETCH_TIMEOUT_MS = 10_000;
/** The most redirects followed (api.vrchat.cloud → files.vrchat.cloud). */
const MAX_REDIRECTS = 3;
const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif)$/;

/** An https URL on WORLD_IMAGE_HOSTS. */
export const isWorldImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && WORLD_IMAGE_HOSTS.includes(url.hostname)
    );
  } catch {
    return false;
  }
};

/** A body, read until `max` bytes; null (and cancelled) past that. */
const readCapped = async (
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array | null> => {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
};

/**
 * The picture at `url`: its redirects followed by hand, each checked to
 * stay on VRChat's file servers before it is fetched, and its body read
 * up to WORLD_IMAGE_MAX_BYTES. Why it failed, as text, otherwise.
 */
export const fetchPicture = async (
  url: string,
  fetchFn: typeof fetch,
): Promise<{ bytes: Uint8Array; type: string } | string> => {
  if (!isWorldImageUrl(url)) return "not on VRChat's file servers";
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let at = url;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchFn(at, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": VRCHAT_USER_AGENT },
      });
    } catch (err) {
      return `fetch failed: ${String(err)}`;
    }
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => {});
      const location = res.headers.get("Location");
      if (!location || hop >= MAX_REDIRECTS) return `redirect ${res.status}`;
      const next = new URL(location, at).href;
      if (!isWorldImageUrl(next)) return "redirect off VRChat's file servers";
      at = next;
      continue;
    }
    const type = (res.headers.get("Content-Type") ?? "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPE.test(type)) {
      void res.body?.cancel().catch(() => {});
      return `${res.status} ${type}`;
    }
    const length = Number(res.headers.get("Content-Length") ?? 0);
    if (length > WORLD_IMAGE_MAX_BYTES) {
      void res.body?.cancel().catch(() => {});
      return `too large (${length})`;
    }
    const bytes = await readCapped(res.body, WORLD_IMAGE_MAX_BYTES);
    return bytes ? { bytes, type } : "too large";
  }
};
