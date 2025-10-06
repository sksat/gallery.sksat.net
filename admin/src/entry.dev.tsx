import { type PlatformNode } from "@builder.io/qwik-city/middleware/node";

declare global {
  interface QwikCityPlatform extends PlatformNode {}
}

export { default } from "./entry.ssr";
