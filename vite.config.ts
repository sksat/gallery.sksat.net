import { defineConfig } from "vite";
import { qwikVite } from "@builder.io/qwik/optimizer";
import { qwikCity } from "@builder.io/qwik-city/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => {
  return {
    plugins: [
      qwikCity(),
      qwikVite({
        devTools: {
          // The dev server's image checks outline (in red, with "CLS …")
          // whatever shifted while the page loaded, e.g. a tile whose
          // photo's size is known only once it loads: on or not by timing.
          // Off for the tests' server (playwright.config.ts).
          imageDevTools: process.env.QWIK_IMAGE_DEV_TOOLS !== "false",
        },
      }),
      tsconfigPaths(),
      tailwindcss(),
    ],
    server: {
      headers: {
        "Cache-Control": "public, max-age=0",
      },
    },
    preview: {
      headers: {
        "Cache-Control": "public, max-age=600",
      },
    },
  };
});
