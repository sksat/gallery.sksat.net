/**
 * The URL to share for a photo: its own page, `/photo/<id>/`, without the
 * gallery's filter/sort query or `?camera=`, so the link opens the same
 * photo for anyone, wherever it was opened from (the overlay or the photo
 * page). It ends in a slash like og:url.
 */
export const shareUrl = (origin: string, photoId: string): string =>
  `${origin}/photo/${encodeURIComponent(photoId)}/`;
