/**
 * A preview of a photo's VRChat world (its name, author, description and
 * picture), read from the world's public page on vrchat.com, for the card
 * the gallery shows on the world link.
 *
 * Only worlds the gallery itself links to are previewed: the world of a
 * public or unlisted photo whose world level shows the link (the photo's
 * projected answer, kept per content version like every other answer, has
 * its `world.id`). So this is never a proxy for any world id, and a
 * viewer's browser never talks to vrchat.com: the page is fetched here,
 * and its picture through the image Worker (/img/world/<public_id>).
 *
 * Previews are kept in the data centre's Cache API by world id, for
 * PREVIEW_TTL (a failure for FAILURE_TTL), apart from the content
 * version: a world's page does not change with the gallery.
 */

/** A VRChat world id: wrld_ and a UUID. */
export const WORLD_ID_RE =
  /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type WorldPreview = {
  name: string;
  author: string | null;
  description: string | null;
  /** The world's picture on VRChat's file server (https). */
  image: string | null;
};

/** How long a preview is kept (seconds). */
export const PREVIEW_TTL = 7 * 24 * 60 * 60;
/** How long a failed fetch is remembered (seconds). */
export const FAILURE_TTL = 10 * 60;
/** How long vrchat.com has to answer (ms). */
export const FETCH_TIMEOUT_MS = 5000;
/** The most of the page read (bytes): the tags are in its head. */
const MAX_PAGE_BYTES = 256 * 1024;

/**
 * The User-Agent sent to vrchat.com and its file servers: they answer 403
 * to a request without one, as a Worker's fetch is by default.
 */
export const VRCHAT_USER_AGENT =
  "Mozilla/5.0 (compatible; gallery.sksat.net/1.0; +https://gallery.sksat.net)";

/** Where the pictures may come from. */
export const IMAGE_HOSTS = ["api.vrchat.cloud", "files.vrchat.cloud"];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

const decode = (s: string): string =>
  s
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    );

/** The content of each <meta name|property="…" content="…">. */
const metaTags = (html: string): Map<string, string> => {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = /\b(?:name|property)\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (key && content !== undefined && !tags.has(key.toLowerCase())) {
      tags.set(key.toLowerCase(), decode(content).trim());
    }
  }
  return tags;
};

/** An https URL on one of IMAGE_HOSTS, else null. */
export const imageUrlOf = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && IMAGE_HOSTS.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/**
 * The preview in a world page's tags. The picture's alt text gives the
 * name and the author apart (`A preview image of VRChat world "<name>" by
 * <author>`); without it, the title (`<name> by <author>`) is split at its
 * last " by ". Null without a name.
 */
export const parseWorldPage = (html: string): WorldPreview | null => {
  const tags = metaTags(html);
  const alt = tags.get("og:image:alt") ?? tags.get("twitter:image:alt");
  const fromAlt = alt
    ? /^A preview image of VRChat world "(.*)" by (.+)$/s.exec(alt)
    : null;
  let name: string | null = fromAlt?.[1] ?? null;
  let author: string | null = fromAlt?.[2] ?? null;
  if (!name) {
    const title = tags.get("og:title") ?? tags.get("twitter:title");
    if (title) {
      const at = title.lastIndexOf(" by ");
      name = at > 0 ? title.slice(0, at) : title;
      author = at > 0 ? title.slice(at + 4) : null;
    }
  }
  if (!name) return null;
  const description =
    tags.get("og:description") ?? tags.get("twitter:description") ?? null;
  return {
    name,
    author: author || null,
    description: description || null,
    image: imageUrlOf(tags.get("og:image") ?? tags.get("twitter:image")),
  };
};

/** The part of the Cache API used here. */
export interface PreviewCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export interface PreviewContext {
  cache: PreviewCache;
  fetch: typeof fetch;
  waitUntil: (promise: Promise<unknown>) => void;
  /** Where the world pages are: https://vrchat.com (tests: a fixture). */
  origin: string;
}

/** Not a real host: these entries never answer a public URL. */
const previewKey = (worldId: string) =>
  `https://gallery-api/world/${encodeURIComponent(worldId)}`;

/** Read at most MAX_PAGE_BYTES of a body as text. */
const readHead = async (res: Response): Promise<string> => {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    // Never more than the cap, however large a chunk comes.
    const part = value.subarray(0, MAX_PAGE_BYTES - size);
    chunks.push(part);
    size += part.byteLength;
  }
  void reader.cancel().catch(() => {});
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

/**
 * A world's preview: kept, or read from its page and kept. Null when the
 * page cannot be read or has no name (also kept, for FAILURE_TTL).
 */
export const worldPreview = async (
  worldId: string,
  ctx: PreviewContext,
): Promise<WorldPreview | null> => {
  if (!WORLD_ID_RE.test(worldId)) return null;
  const key = previewKey(worldId);
  const hit = await ctx.cache.match(key);
  if (hit) return (await hit.json()) as WorldPreview | null;

  let preview: WorldPreview | null = null;
  try {
    const res = await ctx.fetch(
      `${ctx.origin.replace(/\/$/, "")}/home/world/${worldId}`,
      {
        headers: { Accept: "text/html", "User-Agent": VRCHAT_USER_AGENT },
        // A redirect is a failure: never fetch anywhere else.
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (res.ok) preview = parseWorldPage(await readHead(res));
    else void res.body?.cancel().catch(() => {});
  } catch (err) {
    console.error(`world page ${worldId}:`, err);
  }
  const ttl = preview ? PREVIEW_TTL : FAILURE_TTL;
  ctx.waitUntil(
    ctx.cache.put(
      key,
      new Response(JSON.stringify(preview), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, s-maxage=${ttl}`,
        },
      }),
    ),
  );
  return preview;
};

/**
 * The world id a photo's projected answer links to (`world.id`, given only
 * at the world level "link"), or null.
 */
export const linkedWorldId = (photo: unknown): string | null => {
  const world = (photo as { world?: { id?: unknown } | null } | null)?.world;
  const id = world?.id;
  return typeof id === "string" && WORLD_ID_RE.test(id) ? id : null;
};
