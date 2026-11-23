import { describe, expect, it } from "vitest";
import { brandOf, isPublicHostname } from "./referrer-icon";
import { BRAND_ICONS } from "./referrer-icons.gen";

describe("brandOf", () => {
  it.each([
    ["t.co", "x"],
    ["x.com", "x"],
    ["mobile.twitter.com", "x"],
    ["www.google.com", "google"],
    ["www.google.co.jp", "google"],
    ["google.de", "google"],
    ["duckduckgo.com", "duckduckgo"],
    ["discord.com", "discord"],
    ["github.com", "github"],
    ["bsky.app", "bluesky"],
    ["go.bsky.app", "bluesky"],
    ["l.facebook.com", "facebook"],
    ["l.instagram.com", "instagram"],
    ["m.youtube.com", "youtube"],
    ["out.reddit.com", "reddit"],
    ["b.hatena.ne.jp", "hatena"],
    ["mstdn.jp", "fediverse"],
    ["misskey.io", "fediverse"],
    ["mastodon.example.org", "fediverse"],
    ["misskey-example.net", "fediverse"],
    ["MISSKEY.IO.", "fediverse"],
  ])("%s → %s", (host, brand) => {
    expect(brandOf(host)).toBe(brand);
  });

  it.each([
    "",
    "notgithub.com",
    "github.com.evil.example",
    "google.evil.com",
    "googleusercontent.com",
    "www.bing.com",
    "blog.example.com",
  ])("%s has no brand", (host) => {
    expect(brandOf(host)).toBeNull();
  });

  it("every brand has a bundled icon", () => {
    for (const host of ["t.co", "www.google.com", "misskey.io", "zenn.dev"]) {
      expect(BRAND_ICONS[brandOf(host)!]).toBeDefined();
    }
  });
});

describe("isPublicHostname", () => {
  it.each(["example.com", "www.bing.com", "a-b.co.jp", "xn--wgv71a.jp", "t.co"])(
    "%s is allowed",
    (host) => {
      expect(isPublicHostname(host)).toBe(true);
    },
  );

  it.each([
    "",
    "localhost",
    "foo.localhost",
    "com",
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "0x7f.1",
    "2130706433",
    "[::1]",
    "::1",
    "fe80::1",
    "example.com:8080",
    "user@example.com",
    "example.com/path",
    "Example.com",
    "-bad.com",
    "bad-.com",
    "a..com",
    "printer.local",
    "router.lan",
    "svc.internal",
    "x.home.arpa",
    "1.0.0.127.in-addr.arpa",
    "127.0.0.1.nip.io",
    "10.0.0.1.sslip.io",
    "app.lvh.me",
    "foo.test",
    "hidden.onion",
    `${"a".repeat(64)}.com`,
    `${"a.".repeat(127)}com`,
  ])("%s is refused", (host) => {
    expect(isPublicHostname(host)).toBe(false);
  });
});
