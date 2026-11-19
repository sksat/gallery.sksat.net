import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";
import {
  isReadDone,
  readGeneration,
  setReadDone,
  UNREAD_EVENT,
} from "~/lib/read-state";
import { Spinner } from "./submit-button";
import { muted } from "./ui";

// Reads the originals' metadata in the background while an admin page is
// open (POST /api/metadata/backfill, src/lib/backfill.ts): when the
// browser is idle after a page view, it reads the photos waiting a batch
// at a time, one request after another, only while the tab is visible,
// and stops at the first error (a later page view tries again) or when
// nothing is left. Once nothing is left the tab remembers it
// (src/lib/read-state.ts), so it asks again only in a new tab, after the
// parser changes, an upload or ファイルの値に戻す. All it shows is a small
// spinner while it reads; nothing otherwise.

// (An object: Qwik moves the task into a module of its own, which cannot
// reassign this one's variables.) One reader per tab across client-side
// navigations; `failedAt` keeps it to one try a minute after an error.
const reader = { active: false, failedAt: 0 };
const RETRY_AFTER_ERROR_MS = 60_000;

const whenVisible = () =>
  document.visibilityState === "visible"
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const on = () => {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", on);
          resolve();
        };
        document.addEventListener("visibilitychange", on);
      });

const whenIdle = () =>
  new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => resolve(), { timeout: 5000 });
    } else {
      setTimeout(resolve, 1000);
    }
  });

type Batch = { read: number; more: boolean };

export const MetadataReader = component$(() => {
  const loc = useLocation();
  /** Whether this run has found something to read (the spinner). */
  const reading = useSignal(false);
  // eslint-disable-next-line qwik/no-use-visible-task -- runs only in the browser, after load, by design
  useVisibleTask$(
    ({ track, cleanup }) => {
      track(() => loc.url.pathname);
      /** Read until nothing is left; false on an error. */
      const readAll = async (): Promise<boolean> => {
        for (;;) {
          await whenVisible();
          const res = await fetch("/api/metadata/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (!res.ok) return false;
          const batch = (await res.json()) as Batch;
          if (batch.read > 0) reading.value = true;
          if (!batch.more) return true;
        }
      };
      const run = async () => {
        if (
          isReadDone() ||
          reader.active ||
          Date.now() - reader.failedAt < RETRY_AFTER_ERROR_MS
        ) {
          return;
        }
        reader.active = true;
        try {
          await whenIdle();
          // Again while markUnread happened during a run (an upload).
          for (;;) {
            const generation = readGeneration();
            if (!(await readAll())) {
              reader.failedAt = Date.now();
              break;
            }
            setReadDone(generation);
            if (readGeneration() === generation) break;
          }
        } catch {
          // Offline: a later page view tries again.
          reader.failedAt = Date.now();
        } finally {
          reading.value = false;
          reader.active = false;
        }
      };
      void run();
      // ファイルの値に戻す on this very page: read without waiting for a
      // navigation.
      const onUnread = () => void run();
      window.addEventListener(UNREAD_EVENT, onUnread);
      cleanup(() => window.removeEventListener(UNREAD_EVENT, onUnread));
    },
    // Not tied to this (usually empty) span being on screen.
    { strategy: "document-idle" },
  );

  return (
    <span class="ml-auto flex items-center" data-testid="metadata-reader">
      {reading.value && (
        // No role="status": a background chore, not worth announcing (and
        // the page's toast is the status).
        <span
          class={["flex items-center", muted]}
          title="撮影データを読み込み中"
        >
          <Spinner />
          <span class="sr-only">撮影データを読み込み中</span>
        </span>
      )}
    </span>
  );
});
