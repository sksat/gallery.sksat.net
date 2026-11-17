import { defineConfig } from "vite";
import { qwikVite } from "@builder.io/qwik/optimizer";
import { qwikCity } from "@builder.io/qwik-city/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => {
  return {
    plugins: [
      qwikCity(),
      // preventNavigate: the edit page's unsaved-changes guard
      // (usePreventNavigate$ covers both in-app links and leaving the tab).
      qwikVite({ experimental: ["preventNavigate"] }),
      tsconfigPaths(),
      tailwindcss(),
    ],
    preview: {
      headers: {
        "Cache-Control": "public, max-age=600",
      },
    },
  };
});
