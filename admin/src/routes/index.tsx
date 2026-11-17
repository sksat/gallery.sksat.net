import { component$ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
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
            Browse every photo in D1 and edit its visibility, world, camera and
            tags. The public site reads D1 through the API Worker, so saved
            edits show up there within about a minute.
          </p>
          <div class="mt-4">
            <Link href="/media/" class={buttonSecondary}>
              Browse and edit metadata →
            </Link>
          </div>
        </section>

        <section class={[card, "flex flex-col p-5"]}>
          <h2 class="text-base font-semibold">Cameras</h2>
          <p class={["mt-1 flex-1 text-sm", muted]}>
            Register cameras with their manufacturer, product page and pictures,
            and link photos to them.
          </p>
          <div class="mt-4">
            <Link href="/camera/" class={buttonSecondary}>
              Manage cameras →
            </Link>
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
