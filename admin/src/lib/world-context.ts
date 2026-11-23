import type { RequestEventCommon } from "@builder.io/qwik-city";
import { defaultCache } from "./cf-graphql";
import { NO_CACHE, type WorldContext } from "./world-preview";

/**
 * The world routes' context: the data centre's cache, and vrchat.com
 * unless VRCHAT_ORIGIN says otherwise (E2E: a fake on loopback).
 */
export const worldContext = (ev: RequestEventCommon): WorldContext => {
  const env = (ev.platform as { env?: Record<string, unknown> } | undefined)
    ?.env;
  const ctx = (
    ev.platform as
      { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined
  )?.ctx;
  const origin =
    typeof env?.VRCHAT_ORIGIN === "string" && env.VRCHAT_ORIGIN !== ""
      ? env.VRCHAT_ORIGIN
      : "https://vrchat.com";
  return {
    cache: defaultCache() ?? NO_CACHE,
    fetch: (input, init) => fetch(input, init),
    waitUntil: (p) => {
      if (ctx?.waitUntil) ctx.waitUntil(p);
      else void p.catch(() => {});
    },
    origin,
  };
};
