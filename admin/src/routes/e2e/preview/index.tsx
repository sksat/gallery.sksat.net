import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { PhotoPreview } from "~/components/photo-preview";
import { e2eRoutesEnabled } from "~/lib/e2e-routes";

// E2E only: the edit page's photo preview with thumbnails on, served from
// /e2e-thumb (a path Playwright answers with page.route), since the E2E
// server has no image Worker. 404 unless the E2E server's
// E2E_TEST_ROUTES=1 binding is set and the request is on a loopback host.

export const useEnabled = routeLoader$(({ platform, url, error }) => {
  const env = (platform as { env?: Record<string, unknown> } | undefined)?.env;
  if (!e2eRoutesEnabled(env, url)) {
    throw error(404, "Not found");
  }
  return true;
});

export default component$(() => {
  useEnabled();
  return (
    <div class="mx-auto max-w-3xl">
      <PhotoPreview
        file="/mock/vrchat1.png"
        world="VRChat"
        imageBase="/e2e-thumb"
      />
    </div>
  );
});
