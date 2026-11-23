import { describe, expect, it, vi } from "vitest";
import { VRCHAT_USER_AGENT } from "@shared/vrchat/world";
import {
  handleWorldCard,
  handleWorldImage,
  parseWorldCard,
  worldCardPath,
  worldImagePath,
  type WorldContext,
} from "./world-preview";

const WORLD = "wrld_0123abcd-4567-89ab-cdef-0123456789ab";
const IMAGE = "https://api.vrchat.cloud/api/1/file/file_x/1/file";
const PAGE = `<html><head>
<meta property="og:image" content="${IMAGE}">
<meta property="og:image:alt" content="A preview image of VRChat world &quot;Home&quot; by someone">
<meta property="og:description" content="A quiet room.">
</head></html>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const context = () => {
  const store = new Map<string, Response>();
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === `https://vrchat.test/home/world/${WORLD}`) {
      return new Response(PAGE, { headers: { "Content-Type": "text/html" } });
    }
    if (url === IMAGE) {
      return new Response(PNG, { headers: { "Content-Type": "image/png" } });
    }
    return new Response("nope", { status: 404 });
  });
  const pending: Promise<unknown>[] = [];
  const ctx: WorldContext = {
    cache: {
      match: async (k) => store.get(k)?.clone(),
      put: async (k, r) => void store.set(k, r),
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    waitUntil: (p) => void pending.push(p),
    origin: "https://vrchat.test",
  };
  return { ctx, fetch, settle: () => Promise.all(pending) };
};

describe("world routes", () => {
  it("answers the card, kept after the first read", async () => {
    const { ctx, fetch, settle } = context();
    const res = await handleWorldCard(WORLD, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/^private/);
    expect(await res.json()).toEqual({
      name: "Home",
      author: "someone",
      description: "A quiet room.",
      image: true,
    });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      "User-Agent": VRCHAT_USER_AGENT,
    });
    await settle();
    await handleWorldCard(WORLD, ctx);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes the picture on, from VRChat's file servers only", async () => {
    const { ctx, settle } = context();
    const res = await handleWorldImage(WORLD, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    await settle();
    expect((await handleWorldImage(WORLD, ctx)).status).toBe(200);
  });

  it("refuses anything but a world id, and 404s a world without a page", async () => {
    const { ctx, fetch } = context();
    expect((await handleWorldCard("https://evil/", ctx)).status).toBe(400);
    expect((await handleWorldImage("wrld_x", ctx)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const other = "wrld_00000000-0000-0000-0000-000000000000";
    expect((await handleWorldCard(other, ctx)).status).toBe(404);
    expect((await handleWorldImage(other, ctx)).status).toBe(404);
  });

  it("has its paths and parses the card", () => {
    expect(worldCardPath(WORLD)).toBe(`/api/world/${WORLD}/`);
    expect(worldImagePath(WORLD)).toBe(`/api/world/${WORLD}/image/`);
    expect(parseWorldCard({ name: "", image: true })).toBeNull();
    expect(parseWorldCard({ name: "Home", image: "yes" })).toEqual({
      name: "Home",
      author: null,
      description: null,
      image: false,
    });
  });
});
