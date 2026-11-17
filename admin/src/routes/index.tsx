import { component$ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { PublishButton } from "~/components/publish-button";
import { buttonSecondary, card, muted } from "~/components/ui";

export default component$(() => {
  return (
    <div class="space-y-8">
      <div>
        <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Gallery Admin Dashboard
        </h1>
        <p class={["mt-2 max-w-2xl text-sm", muted]}>
          This is the admin panel for gallery.sksat.net, protected by Cloudflare
          Access.
        </p>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Media</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Browse every photo in D1 and edit its world, camera and tags. Edits
            are saved to D1 immediately.
          </p>
          <div class="mt-4">
            <Link href="/media/" class={buttonSecondary}>
              Browse and edit metadata →
            </Link>
          </div>
        </section>

        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Publish</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Regenerate <code>media.json</code> and <code>cameras.json</code>{" "}
            from D1 and upload them to the public bucket. The public gallery
            only sees edits after this step.
          </p>
          <div class="mt-4">
            <PublishButton />
          </div>
        </section>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Admin Dashboard - gallery.sksat.net",
  meta: [
    {
      name: "description",
      content: "Admin panel for managing gallery.sksat.net",
    },
  ],
};
