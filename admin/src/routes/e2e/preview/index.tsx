import { $, component$, useSignal } from "@builder.io/qwik";
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
  const pendingCount = useSignal(0);
  const notHere = $(async () => ({
    ok: false as const,
    message: "not on this page",
  }));
  return (
    <div class="mx-auto max-w-3xl">
      <PhotoPreview
        id={2}
        file="/mock/vrchat1.png"
        world="VRChat"
        timestamp="2023-12-02T00:00:00Z"
        visibility="public"
        imageBase="/e2e-thumb"
        neighbors={null}
        listHref="/e2e/preview/"
        dirty={false}
        pendingCount={pendingCount}
        onApply$={notHere}
        onUndo$={notHere}
      />
    </div>
  );
});
