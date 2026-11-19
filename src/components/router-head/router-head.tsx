import { useDocumentHead, useLocation } from "@builder.io/qwik-city";

import { component$ } from "@builder.io/qwik";

// Public value (it appears in every page's HTML).
const CF_BEACON_TOKEN: string | undefined = import.meta.env
  .VITE_CF_BEACON_TOKEN;

/**
 * The RouterHead component is placed inside of the document `<head>` element.
 */
export const RouterHead = component$(() => {
  const head = useDocumentHead();
  const loc = useLocation();

  return (
    <>
      <title>{head.title}</title>

      {/* Without the query: a filter, sort order or the list a photo page
          (or the gallery's overlay on its URL) was opened from are views of the same
          page, not pages of their own. */}
      <link rel="canonical" href={loc.url.origin + loc.url.pathname} />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="theme-color" content="#151934" />
      <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
      <link rel="icon" type="image/png" href="/icon-192.png" sizes="192x192" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

      {/* Cloudflare Web Analytics (cookieless). Production only: the token
          is set in .env.production, so dev and tests send no beacons. */}
      {CF_BEACON_TOKEN && (
        <script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
        />
      )}

      {head.meta.map((m) => (
        <meta key={m.key} {...m} />
      ))}

      {head.links.map((l) => (
        <link key={l.key} {...l} />
      ))}

      {head.styles.map((s) => (
        <style key={s.key} {...s.props} dangerouslySetInnerHTML={s.style} />
      ))}

      {head.scripts.map((s) => (
        <script key={s.key} {...s.props} dangerouslySetInnerHTML={s.script} />
      ))}
    </>
  );
});
