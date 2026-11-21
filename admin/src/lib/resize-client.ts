// The browser side of making resized copies: the requests runResize
// (resize-job.ts) makes to /api/resized, and the uploads waiting for
// theirs (queueResize, called when an upload completes). Browser only.

import { drawCard } from "./og-card";
import type { ClaimedPhoto, WantedCard } from "./resized";
import type { CardDeps, PendingFiles, ResizeDeps } from "./resize-job";
import { makeResized, ResizeError, type MadeCopy } from "./resize-make";

/** Window event: an upload is waiting for its copies. */
export const RESIZE_QUEUED_EVENT = "admin-resize-queued";

/** Uploaded files waiting for their copies (one map per tab). */
export const pendingUploads: PendingFiles = new Map();

/** A photo just uploaded from `file`: make its copies from that file. */
export const queueResize = (id: number, file: Blob): void => {
  pendingUploads.set(id, file);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RESIZE_QUEUED_EVENT));
  }
};

const fail = (what: string, status: number) =>
  new Error(`${what}: HTTP ${status}`);

export const browserResizeDeps = (
  pace: () => Promise<void>,
  onMade?: () => void,
): ResizeDeps => ({
  async claim(ids) {
    const res = await fetch("/api/resized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    if (!res.ok) throw fail("claim", res.status);
    return (await res.json()) as { photos: ClaimedPhoto[]; more: boolean };
  },
  async fetchFile(p) {
    const res = await fetch(
      `/api/resized/${p.id}/source?${new URLSearchParams({ claim: p.claim })}`,
    );
    // Not in the bucket (or the claim is gone): nothing to make it from.
    if (res.status === 404) throw new ResizeError("no file");
    if (!res.ok) throw fail("source", res.status);
    return res.blob();
  },
  make: makeResized,
  async store(p, copies: MadeCopy[]) {
    const form = new FormData();
    form.set("claim", p.claim);
    form.set("source", String(p.source.id));
    form.set(
      "manifest",
      JSON.stringify(copies.map(({ blob: _, ...rest }) => rest)),
    );
    for (const c of copies) if (c.blob) form.set(c.preset, c.blob, c.preset);
    if (copies.some((c) => c.preset === "og")) {
      form.set("caption", JSON.stringify(p.caption));
    }
    const res = await fetch(`/api/resized/${p.id}`, {
      method: "POST",
      body: form,
    });
    // Refused as made (e.g. a size off its box): not worth trying again
    // at once.
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new ResizeError(`refused: ${body?.error ?? "400"}`);
    }
    if (!res.ok) throw fail("store", res.status);
    return ((await res.json()) as { ok: boolean }).ok;
  },
  async fail(p) {
    const res = await fetch(`/api/resized/${p.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim: p.claim, failed: true }),
    });
    if (!res.ok) throw fail("fail", res.status);
  },
  pace,
  onMade,
});

export const browserCardDeps = (pace: () => Promise<void>): CardDeps => ({
  async wanted(cursor) {
    const res = await fetch("/api/resized/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { cursor } : {}),
    });
    // No caption source (previews, or the Worker not bound): nothing to do.
    if (res.status === 503) return { cards: [], cursor: null };
    if (!res.ok) throw fail("cards", res.status);
    return (await res.json()) as {
      cards: WantedCard[];
      cursor: string | null;
    };
  },
  async fetchCopy(card) {
    // The largest stored copy (the photo's own size when it is smaller).
    const res = await fetch(`/thumb/w3840${card.file}`);
    if (!res.ok || res.headers.has("X-Image-Fallback")) {
      await res.body?.cancel();
      return null;
    }
    return res.blob();
  },
  async draw(copy, card) {
    const image = await createImageBitmap(copy);
    try {
      return await drawCard(image, card.caption);
    } finally {
      image.close();
    }
  },
  async store(card, og) {
    const form = new FormData();
    form.set("source", String(card.sourceFileId));
    form.set("caption", JSON.stringify(card.caption));
    form.set("og", og, "og");
    const res = await fetch(`/api/resized/${card.id}/card`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw fail("card", res.status);
    return ((await res.json()) as { ok: boolean }).ok;
  },
  pace,
});
