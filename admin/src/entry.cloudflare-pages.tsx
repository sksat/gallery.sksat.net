/*
 * WHAT IS THIS FILE?
 *
 * It's the entry point for Cloudflare Pages when building for production.
 *
 * Learn more about the Cloudflare Pages integration here:
 * - https://qwik.builder.io/docs/deployments/cloudflare-pages/
 *
 */
import {
  createQwikCity,
  type PlatformCloudflarePages,
} from "@builder.io/qwik-city/middleware/cloudflare-pages";
import qwikCityPlan from "@qwik-city-plan";
import { manifest } from "@qwik-client-manifest";
import render from "./entry.ssr";
import { handlePlayGet, PLAY_GET_RE } from "./lib/play-serve";
import { handlePlayPut, PLAY_PUT_RE } from "./lib/play-upload";

declare global {
  interface QwikCityPlatform extends PlatformCloudflarePages {}
}

const qwikCity = createQwikCity({ render, qwikCityPlan, manifest });

/**
 * Qwik City, except for a video's playback copy, whose bytes go between
 * the request and R2 without passing through Qwik City's streams: its
 * upload's parts (src/lib/play-upload.ts) and the edit page's player
 * (src/lib/play-serve.ts). Both check Access themselves.
 */
const fetch: typeof qwikCity = (request, env, ctx) => {
  const { pathname } = new URL(request.url);
  const bindings = env as unknown as Record<string, unknown>;
  if (request.method === "PUT" && PLAY_PUT_RE.test(pathname)) {
    return handlePlayPut(request, bindings);
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    PLAY_GET_RE.test(pathname)
  ) {
    return handlePlayGet(request, bindings);
  }
  return qwikCity(request, env, ctx);
};

export { fetch };
