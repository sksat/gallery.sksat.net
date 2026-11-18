/**
 * Server-side access to the API Worker (workers/api) for route loaders.
 *
 * In production the Pages Function reaches it through the `API` service
 * binding (wrangler.jsonc): a plain fetch() of gallery.sksat.net/api/* from
 * a Function on the same zone would not reliably go through the Worker's
 * route. Without the binding (dev, tests) it fetches VITE_API_BASE_URL.
 */
import type { RequestEventBase } from "@builder.io/qwik-city";

import {
  parseMediaItem,
  parseMediaList,
  type CameraJSON,
  type MediaInfoJSON,
} from "~/components/gallery/types";
import { parseCameras } from "~/components/gallery/cameras";

type Fetcher = { fetch: (request: Request) => Promise<Response> };

/** GET `/api<path>` from the API Worker. */
export const apiGet = (
  event: Pick<RequestEventBase, "platform">,
  path: string,
): Promise<Response> => {
  const binding = (event.platform as { env?: { API?: Fetcher } } | undefined)
    ?.env?.API;
  // The host is a placeholder: a service binding ignores it.
  if (binding) return binding.fetch(new Request(`https://gallery-api/api${path}`));
  const base = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(
    /\/$/,
    "",
  );
  return fetch(base + path);
};

/** Thrown when the API cannot be read (the page answers 503). */
export class ApiError extends Error {}

/**
 * The error page's message when the API cannot be read at all: it answers
 * from its last-good snapshot while D1 is down, so this means it has none
 * either.
 */
export const UNAVAILABLE =
  "The gallery is temporarily unavailable. Please try again in a few minutes.";

const getJson = async (
  event: Pick<RequestEventBase, "platform">,
  path: string,
): Promise<unknown | null> => {
  const res = await apiGet(event, path);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`GET /api${path}: ${res.status}`);
  return res.json();
};

/**
 * A list endpoint's array. A 404 or anything but an array means the API is
 * misconfigured (wrong base URL or binding), not that the list is empty:
 * that must fail loudly rather than render, and get cached as, no photos.
 */
const getList = async (
  event: Pick<RequestEventBase, "platform">,
  path: string,
): Promise<unknown[]> => {
  const data = await getJson(event, path);
  if (!Array.isArray(data)) {
    throw new ApiError(`GET /api${path}: not a list`);
  }
  return data;
};

/** Every public photo, newest first. */
export const loadMedia = async (
  event: Pick<RequestEventBase, "platform">,
): Promise<MediaInfoJSON[]> => parseMediaList(await getList(event, "/media"));

/** Every camera that has a public photo. */
export const loadCameras = async (
  event: Pick<RequestEventBase, "platform">,
): Promise<CameraJSON[]> =>
  parseCameras(await getList(event, "/camera")) ?? [];

/** A public or unlisted photo; null if there is none (or it is private). */
export const loadPhoto = async (
  event: Pick<RequestEventBase, "platform">,
  id: string,
): Promise<MediaInfoJSON | null> =>
  parseMediaItem(await getJson(event, `/media/${id}`));

/** A camera by slug; null if unknown (or used only by private photos). */
export const loadCamera = async (
  event: Pick<RequestEventBase, "platform">,
  slug: string,
): Promise<CameraJSON | null> =>
  parseCameras([await getJson(event, `/camera/${encodeURIComponent(slug)}`)])?.at(
    0,
  ) ?? null;
