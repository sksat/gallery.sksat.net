/**
 * The URL to share for the photo shown at `href`: the photo page itself,
 * without the gallery's filter/sort query, `?camera=` or a fragment, so the
 * link opens the same photo for anyone. It ends in a slash like og:url, the
 * form Qwik City redirects `/photo/<id>` to.
 */
export const shareUrl = (href: string): string => {
  const url = new URL(href);
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url.origin + path;
};
