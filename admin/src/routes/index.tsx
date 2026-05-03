import { component$ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { PublishButton } from "~/components/publish-button";

export default component$(() => {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Gallery Admin Dashboard</h1>
      <p>
        This is the admin panel for gallery.sksat.net, protected by Cloudflare
        Access.
      </p>

      <div style={{ marginTop: "2rem" }}>
        <h2>Media</h2>
        <p>
          <Link href="/media/">Browse and edit metadata →</Link>
        </p>
        <p style={{ color: "#666", fontSize: "0.9em" }}>
          Edits are saved to D1 immediately. Click Publish to regenerate
          <code> media.json</code> on the public bucket.
        </p>
        <PublishButton />
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
