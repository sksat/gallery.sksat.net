// Which icon a referrer row shows (components/referrer-icon.tsx): a
// bundled brand icon for well-known hosts (referrer-icons.gen.ts), the
// site's own favicon through /api/favicon/<host> for any other public
// host name (lib/favicon.ts), a globe for anything else.

/** Hosts and their subdomains, by brand key of referrer-icons.gen.ts. */
const BRAND_HOSTS: [string, string[]][] = [
  ["x", ["t.co", "x.com", "twitter.com"]],
  ["duckduckgo", ["duckduckgo.com"]],
  ["discord", ["discord.com", "discordapp.com", "discord.gg"]],
  ["github", ["github.com"]],
  ["bluesky", ["bsky.app", "bsky.social"]],
  ["facebook", ["facebook.com", "fb.com", "fb.me"]],
  ["instagram", ["instagram.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["reddit", ["reddit.com", "redd.it"]],
  ["hatena", ["hatena.ne.jp"]],
  ["line", ["line.me"]],
  ["threads", ["threads.net", "threads.com"]],
  ["pixiv", ["pixiv.net"]],
  ["note", ["note.com"]],
  ["qiita", ["qiita.com"]],
  ["zenn", ["zenn.dev"]],
  [
    "fediverse",
    [
      "mastodon.social",
      "mastodon.online",
      "mastodon.cloud",
      "mstdn.jp",
      "mstdn.social",
      "fedibird.com",
      "pawoo.net",
      "misskey.io",
      "misskey.design",
      "nijimiss.moe",
      "sushi.ski",
      "social.vivaldi.net",
      "fosstodon.org",
      "hachyderm.io",
    ],
  ],
];

const BY_HOST = new Map(
  BRAND_HOSTS.flatMap(([key, hosts]) => hosts.map((h) => [h, key] as const)),
);

/**
 * The brand of a referrer host, or null: the host or a parent domain in
 * the list ("l.facebook.com" is facebook), Google on any country domain
 * ("www.google.co.jp"), and Mastodon / Misskey servers by name
 * ("mastodon.example", "misskey.example", "mstdn.example").
 */
export const brandOf = (rawHost: string): string | null => {
  const host = rawHost.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const key = BY_HOST.get(labels.slice(i).join("."));
    if (key) return key;
  }
  // google.com, google.co.jp, www.google.de, …
  if (/(^|\.)google\.(com|[a-z]{2}|com?\.[a-z]{2})$/.test(host)) {
    return "google";
  }
  if (/(^|\.)(mastodon|mstdn|misskey)(\.|-)/.test(host)) return "fediverse";
  return null;
};

/** Suffixes that are not public sites, or that name any IP address. */
const PRIVATE_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "home.arpa",
  "arpa",
  "test",
  "example",
  "invalid",
  "onion",
  "alt",
  // Wildcard DNS that resolves to the address in the name.
  "nip.io",
  "sslip.io",
  "xip.io",
  "localtest.me",
  "lvh.me",
];

/**
 * Whether a referrer host may be looked up for its favicon: a plain DNS
 * name of a public site. Lower case letters, digits and hyphens in 1–63
 * character labels, at least two labels, a top-level label that is not
 * all digits (so no IPv4 address in any spelling, and IPv6 has colons),
 * no port or user, and nothing local or reserved (PRIVATE_SUFFIXES). It
 * says nothing of where the name resolves to: the fetch itself runs in
 * Cloudflare, which does not reach private networks.
 */
export const isPublicHostname = (host: string): boolean => {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  for (const l of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return false;
  }
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return false;
  return !PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
};
