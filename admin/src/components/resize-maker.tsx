import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";
import { RESIZED_DATE } from "~/lib/resized";
import {
  browserCardDeps,
  browserResizeDeps,
  pendingUploads,
  RESIZE_QUEUED_EVENT,
} from "~/lib/resize-client";
import { runCards, runResize } from "~/lib/resize-job";
import { Spinner } from "./submit-button";
import { muted } from "./ui";

// Makes the photos' resized copies in the background while an admin page
// is open (src/lib/resized.ts, resize-job.ts): first the photos this tab
// just uploaded, from the files in hand, then any photo still waiting
// (each one's file fetched, decoded and scaled here), one photo at a time,
// only while the tab is visible and the browser idle. It stops at the
// first error (a later page view tries again, at most once a minute) or
// when nothing is left, which the tab remembers in sessionStorage per
// RESIZED_DATE (a new tab asks again; uploads are made either way). Apart
// from that, at most every 5 minutes a page view looks for the `og` cards
// the image Worker asked for and draws them. While it works the header
// shows a spinner and 縮小版を作成中 with the count.

// One maker per tab across client-side navigations (an object: Qwik moves
// the task into a module of its own).
const maker = { active: false, failedAt: 0, cardsAt: 0 };
const RETRY_AFTER_ERROR_MS = 60_000;
/** How often a tab looks for cards the image Worker asked for (one R2 list). */
const CARDS_EVERY_MS = 5 * 60_000;
const DONE_KEY = "admin-resized-done";

const isDone = () => {
  try {
    return sessionStorage.getItem(DONE_KEY) === RESIZED_DATE;
  } catch {
    return false;
  }
};

const setDone = () => {
  try {
    sessionStorage.setItem(DONE_KEY, RESIZED_DATE);
  } catch {
    // Storage blocked: it just asks again next time.
  }
};

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

export const ResizeMaker = component$(() => {
  const loc = useLocation();
  /** Whether a photo is being made (the spinner). */
  const making = useSignal(false);
  /** Copies made by this run, for the label. */
  const made = useSignal(0);
  // eslint-disable-next-line qwik/no-use-visible-task -- runs only in the browser, after load, by design
  useVisibleTask$(
    ({ track, cleanup }) => {
      track(() => loc.url.pathname);
      const run = async () => {
        const now = Date.now();
        const canTry = now - maker.failedAt >= RETRY_AFTER_ERROR_MS;
        const waiting = canTry && !isDone();
        // The image Worker may ask for cards at any time: looked for on a
        // page view at most every few minutes, whatever the copies' state.
        const cards = canTry && now - maker.cardsAt >= CARDS_EVERY_MS;
        if (maker.active || (!waiting && !cards && pendingUploads.size === 0)) {
          return;
        }
        maker.active = true;
        let ok = false;
        try {
          const deps = browserResizeDeps(
            async () => {
              await whenVisible();
              await whenIdle();
              making.value = true;
            },
            () => {
              made.value++;
            },
          );
          await runResize(deps, pendingUploads, { waiting });
          if (waiting) setDone();
          // Then the `og` cards the image Worker asked for (their caption
          // changed since they were made).
          if (cards) {
            maker.cardsAt = Date.now();
            await runCards(browserCardDeps(deps.pace));
          }
          ok = true;
        } catch (err) {
          // Offline, or the server refused: a later page view tries again.
          console.warn("resized copies:", err);
          maker.failedAt = Date.now();
        } finally {
          making.value = false;
          made.value = 0;
          maker.active = false;
          // Uploads that came in after the last claim.
          if (ok && pendingUploads.size > 0) void run();
        }
      };
      void run();
      const onQueued = () => void run();
      window.addEventListener(RESIZE_QUEUED_EVENT, onQueued);
      cleanup(() => window.removeEventListener(RESIZE_QUEUED_EVENT, onQueued));
    },
    // Not tied to this (usually empty) span being on screen.
    { strategy: "document-idle" },
  );

  const label =
    made.value > 0
      ? `縮小版を作成中（${made.value} 枚完了）`
      : "縮小版を作成中";
  return (
    <span class="flex items-center" data-testid="resize-maker">
      {making.value && (
        // No role="status": a background chore, like the metadata reader.
        <span
          class={["flex items-center gap-1.5 text-xs", muted]}
          title={label}
        >
          <Spinner />
          <span class="sr-only sm:not-sr-only">{label}</span>
        </span>
      )}
    </span>
  );
});
