// A referrer site's favicon, fetched by the admin itself (never a
// third-party favicon service, never the browser), for /api/favicon/<host>.
//
// Only https on the default port, to hosts that pass isPublicHostname,
// redirects followed by hand (each hop checked the same way), a time
// limit over the whole lookup, a size cap on every body, and only bytes
// that are a PNG, ICO, GIF, JPEG or WebP image by their first bytes (no
// SVG, which can carry script) are ever answered. So the route cannot
// fetch anything but small raster images from public host names.

import { isPublicHostname } from "./referrer-icon";

/** The largest favicon kept; bigger ones are not used. */
export const MAX_ICON_BYTES = 64 * 1024;
/** How much of a home page is read to find its <link rel="icon">. */
export const MAX_HTML_BYTES = 128 * 1024;
/** The whole lookup, all requests together. */
export const FAVICON_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

export type Favicon = { type: string; body: Uint8Array };

export type FaviconDeps = {
  fetch: typeof fetch;
  /**
   * Where a checked https URL is actually requested: itself, or in E2E
   * the fake server on loopback (favicon route).
   */
  target?: (url: URL) => string;
  timeoutMs?: number;
};

/** A URL the lookup may request: https, default port, a public host. */
export const isAllowedUrl = (url: URL): boolean =>
  url.protocol === "https:" &&
  url.port === "" &&
  url.username === "" &&
  url.password === "" &&
  isPublicHostname(url.hostname);

/** The image type of the first bytes, or null when not an allowed one. */
export const sniffImage = (b: Uint8Array): string | null => {
  const at = (i: number, ...xs: number[]) =>
    xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  // ICO: reserved 0, type 1, at least one image.
  if (at(0, 0, 0, 1, 0) && b.length > 6 && (b[4] > 0 || b[5] > 0)) {
    return "image/x-icon";
  }
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp";
  }
  return null;
};

/**
 * The first icon <link> of a page's HTML, resolved against `base`:
 * rel "icon", "shortcut icon" or "apple-touch-icon" (in that order of
 * preference), null when there is none or its href is not a URL.
 */
export const iconHrefOf = (html: string, base: URL): URL | null => {
  const found: { rank: number; href: string }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*(["']?)([^"'>]*)\1/i.exec(tag)?.[2];
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] ??
      /\bhref\s*=\s*([^\s"'>]+)/i.exec(tag)?.[1];
    if (!rel || !href) continue;
    const rels = rel.toLowerCase().split(/\s+/);
    const rank = rels.includes("icon")
      ? 0
      : rels.includes("apple-touch-icon")
        ? 1
        : -1;
    if (rank >= 0) found.push({ rank, href: decodeEntities(href) });
  }
  found.sort((a, b) => a.rank - b.rank);
  for (const { href } of found) {
    try {
      return new URL(href, base);
    } catch {
      // Not a URL: try the next.
    }
  }
  return null;
};

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/");

/** Reads at most `max` bytes of a body; null when it is longer. */
const readCapped = async (
  res: Response,
  max: number,
  truncate: boolean,
): Promise<Uint8Array | null> => {
  const len = Number(res.headers.get("content-length"));
  if (!truncate && Number.isFinite(len) && len > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      if (!truncate) return null;
      chunks.push(value.subarray(0, value.byteLength - (size - max)));
      size = max;
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
};

/**
 * GET an allowed URL, following up to MAX_REDIRECTS redirects that are
 * allowed too. Null on anything else (a bad hop, an error status).
 */
const get = async (
  url: URL,
  accept: string,
  deps: FaviconDeps,
  signal: AbortSignal,
): Promise<{ res: Response; url: URL } | null> => {
  let cur = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(cur)) return null;
    // Called unbound: workerd's fetch refuses `this` = deps.
    const fetchFn = deps.fetch;
    const res = await fetchFn(deps.target ? deps.target(cur) : cur.href, {
      headers: { accept },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        cur = new URL(loc, cur);
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return { res, url: cur };
  }
  return null;
};

const icon = async (
  url: URL,
  deps: FaviconDeps,
  signal: AbortSignal,
): Promise<Favicon | null> => {
  const got = await get(url, "image/*", deps, signal);
  if (!got) return null;
  const body = await readCapped(got.res, MAX_ICON_BYTES, false);
  const type = body && sniffImage(body);
  return body && type ? { type, body } : null;
};

/** A found favicon is kept this long, a miss (the globe) this long. */
export const FOUND_SECONDS = 7 * 86400;
export const MISSING_SECONDS = 3600;

/** What a host without a usable favicon gets: a grey globe, ours. */
export const GLOBE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';

/** Headers every answer carries: an image that is nothing else. */
const SAFE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

type Cache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
};

/**
 * The answer of /api/favicon/<host>/: 400 for a host that is not allowed;
 * else the favicon (kept FOUND_SECONDS) or the globe (MISSING_SECONDS),
 * from `cache` under `key` when it has it. The browser keeps either for
 * a day at most, privately.
 */
export const faviconResponse = async (
  host: string,
  deps: FaviconDeps & { cache: Cache | null; key: string },
): Promise<Response> => {
  if (!isPublicHostname(host)) {
    return new Response("bad host", { status: 400, headers: SAFE_HEADERS });
  }
  const cached = await deps.cache?.match(deps.key).catch(() => undefined);
  let body: BodyInit;
  let type: string;
  let found: boolean;
  if (cached) {
    body = await cached.arrayBuffer();
    type = cached.headers.get("content-type") ?? "image/svg+xml";
    found = cached.headers.get("x-favicon") === "found";
  } else {
    const icon = await fetchFavicon(host, deps);
    found = icon !== null;
    body = icon ? icon.body.slice() : GLOBE_SVG;
    type = icon ? icon.type : "image/svg+xml";
    const seconds = found ? FOUND_SECONDS : MISSING_SECONDS;
    await deps.cache
      ?.put(
        deps.key,
        new Response(body, {
          headers: {
            "content-type": type,
            "cache-control": `max-age=${seconds}`,
            "x-favicon": found ? "found" : "missing",
          },
        }),
      )
      .catch(() => undefined);
  }
  return new Response(body, {
    headers: {
      ...SAFE_HEADERS,
      "content-type": type,
      "cache-control": `private, max-age=${found ? 86400 : MISSING_SECONDS}`,
      "x-favicon": found ? "found" : "missing",
    },
  });
};

/**
 * The favicon of `host`: /favicon.ico, else the icon its home page links
 * to. Null when the host is not allowed, nothing usable is found or the
 * lookup takes longer than its limit. Never throws.
 */
export const fetchFavicon = async (
  host: string,
  deps: FaviconDeps,
): Promise<Favicon | null> => {
  if (!isPublicHostname(host)) return null;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FAVICON_TIMEOUT_MS);
  try {
    const base = new URL(`https://${host}/`);
    const ico = await icon(new URL("/favicon.ico", base), deps, signal);
    if (ico) return ico;
    const page = await get(base, "text/html", deps, signal);
    if (!page) return null;
    const html = await readCapped(page.res, MAX_HTML_BYTES, true);
    if (!html) return null;
    // Relative hrefs resolve against the page after its redirects.
    const href = iconHrefOf(new TextDecoder().decode(html), page.url);
    return href ? await icon(href, deps, signal) : null;
  } catch (err) {
    // A timeout, a refused connection, a TLS error: no favicon.
    console.warn(`favicon ${host}:`, err instanceof Error ? err.message : err);
    return null;
  }
};
