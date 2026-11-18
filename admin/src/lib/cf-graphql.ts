// Cloudflare's GraphQL Analytics API, for the dashboard's usage cards
// (d1-usage.ts, web-analytics.ts). Both use the optional secret
// CF_ANALYTICS_API_TOKEN: an account API token with only "Account
// Analytics: Read". Answers are cached with the Workers Cache API
// (caches.default) under a URL of our own that is never fetched, so page
// loads do not hammer the API. Fetch, the cache and the clock are injected
// so the callers are covered by Vitest.

import { isLoopback } from "./access";

export const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
/** How long a GraphQL answer is reused. */
export const ANALYTICS_CACHE_SECONDS = 300;

/** The subset of the Cache API used here. */
export type SimpleCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
};

export type GraphqlDeps = {
  fetch: typeof fetch;
  cache: SimpleCache | null;
  now: Date;
  /** GRAPHQL_ENDPOINT unless the E2E fake is bound (graphqlEndpoint). */
  endpoint?: string;
};

/**
 * Where to send GraphQL queries: the E2E server binds
 * E2E_FAKE_GRAPHQL_URL to e2e/fake-graphql.mjs, honoured only when both
 * the request and that URL are on a loopback host (like ACCESS_DISABLED).
 */
export const graphqlEndpoint = (
  platform: { env?: Record<string, unknown> } | undefined,
  url: URL,
): string => {
  const fake = platform?.env?.E2E_FAKE_GRAPHQL_URL;
  if (typeof fake === "string" && fake && isLoopback(url.hostname)) {
    try {
      if (isLoopback(new URL(fake).hostname)) return fake;
    } catch {
      // Not a URL: ignore it.
    }
  }
  return GRAPHQL_ENDPOINT;
};

/** caches.default, or null outside workerd (vite dev, Vitest). */
export const defaultCache = (): SimpleCache | null => {
  const c = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  return c
    ? {
        match: (key) => c.match(new Request(key)),
        put: (key, res) => c.put(new Request(key), res),
      }
    : null;
};

/** The API token, or null when the secret is not set. */
export const getAnalyticsToken = (
  platform: { env?: Record<string, unknown> } | undefined,
): string | null => {
  const t = platform?.env?.CF_ANALYTICS_API_TOKEN;
  return typeof t === "string" && t ? t : null;
};

/** A non-empty string var, or null. */
export const getStringVar = (
  platform: { env?: Record<string, unknown> } | undefined,
  name: string,
): string | null => {
  const v = platform?.env?.[name];
  return typeof v === "string" && v ? v : null;
};

/** Cache key URL for `parts` (each URI-encoded). Never put the token in. */
export const cacheKeyUrl = (...parts: string[]): string =>
  `https://admin-cache.invalid/${parts.map(encodeURIComponent).join("/")}`;

/**
 * POST `body` to the GraphQL API and `parse` the JSON answer (null =
 * unexpected). A cached answer under `key` is used first; only answers
 * that parse are cached. Never throws: failures are logged under `label`
 * and come back as null.
 */
export const cachedGraphql = async <T>(
  opts: {
    token: string;
    key: string;
    body: unknown;
    parse: (json: unknown) => T | null;
    label: string;
  },
  {
    fetch: doFetch,
    cache,
    endpoint = GRAPHQL_ENDPOINT,
  }: Pick<GraphqlDeps, "fetch" | "cache" | "endpoint">,
): Promise<T | null> => {
  const { token, key, body, parse, label } = opts;
  try {
    const hit = await cache?.match(key);
    if (hit) {
      const v = parse(await hit.json());
      if (v !== null) return v;
    }
  } catch (err) {
    console.error(`${label}: cache read failed:`, err);
  }
  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`${label}: GraphQL HTTP`, res.status);
      return null;
    }
    const text = await res.text();
    const v = parse(JSON.parse(text));
    if (v === null) {
      console.error(
        `${label}: unexpected GraphQL response:`,
        text.slice(0, 500),
      );
      return null;
    }
    try {
      await cache?.put(
        key,
        new Response(text, {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${ANALYTICS_CACHE_SECONDS}`,
          },
        }),
      );
    } catch (err) {
      console.error(`${label}: cache write failed:`, err);
    }
    return v;
  } catch (err) {
    console.error(`${label}: GraphQL request failed:`, err);
    return null;
  }
};

/**
 * The single account node of a `viewer { accounts(...) { ... } }` answer,
 * or null when the body has errors or another shape.
 */
export const accountNode = (body: unknown): Record<string, unknown> | null => {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    errors?: unknown;
    data?: { viewer?: { accounts?: unknown } } | null;
  };
  if (Array.isArray(b.errors) && b.errors.length > 0) return null;
  const accounts = b.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) return null;
  const a = accounts[0];
  return a && typeof a === "object" ? (a as Record<string, unknown>) : null;
};

export const finiteNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** "12,345": thousands separators by hand (no Intl, as in format.ts). */
export const formatCount = (n: number): string =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
