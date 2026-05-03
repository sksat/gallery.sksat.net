import type { RequestHandler } from "@builder.io/qwik-city";
import { getB2Env, getDB } from "~/lib/env";
import { publishMediaJson } from "~/lib/publish";

export const onPost: RequestHandler = async ({ platform, json }) => {
  try {
    const db = getDB(platform);
    const env = getB2Env(platform);
    const result = await publishMediaJson(db, env);
    json(200, result);
  } catch (err) {
    json(500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
