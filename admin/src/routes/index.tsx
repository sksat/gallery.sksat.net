import { component$ } from "@builder.io/qwik";
import { type DocumentHead } from "@builder.io/qwik-city";

export default component$(() => {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Gallery Admin Dashboard</h1>
      <p>
        This is the admin panel for gallery.sksat.net, protected by Cloudflare
        Access.
      </p>
      <div style={{ marginTop: "2rem" }}>
        <h2>Status</h2>
        <ul>
          <li>✅ Admin app deployed</li>
          <li>✅ Cloudflare Access configured</li>
          <li>✅ Authentication working</li>
        </ul>
      </div>
      <div style={{ marginTop: "2rem", color: "#666" }}>
        <p>Phase 0: Minimal setup verification complete</p>
        <p>Next steps: D1 database integration and metadata management</p>
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
