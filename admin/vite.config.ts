import { defineConfig, searchForWorkspaceRoot } from "vite";
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
    server: {
      fs: {
        // ../shared (code shared with the public gallery) is outside this
        // project, which is its own pnpm workspace.
        allow: [searchForWorkspaceRoot(process.cwd()), "../shared"],
      },
    },
    preview: {
      headers: {
        "Cache-Control": "public, max-age=600",
      },
    },
  };
});
