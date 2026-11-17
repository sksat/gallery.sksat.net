// Colour theme preference: "system" follows prefers-color-scheme, the other
// two force a scheme. Stored in localStorage and mirrored on
// <html data-theme>; the `dark:` variant in global.css reads that attribute.

export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "admin-theme";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** Anything unknown (null, junk from storage) means "system". */
export const parseTheme = (v: unknown): Theme =>
  v === "light" || v === "dark" ? v : "system";

/** Order the toggle cycles through: system → light → dark → system. */
export const nextTheme = (t: Theme): Theme =>
  THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

const THEME_NAMES: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * aria-label / title of the icon-only toggle: the current mode and what a
 * click does, e.g. "Theme: Dark (switch to System)".
 */
export const themeToggleLabel = (t: Theme): string =>
  `Theme: ${THEME_NAMES[t]} (switch to ${THEME_NAMES[nextTheme(t)]})`;

/**
 * Inline script placed right after the toggle button: sync its label with
 * the theme the <head> script applied (SSR cannot know the stored choice).
 * Labels are precomputed so the script stays tiny.
 */
export const themeToggleLabelScript = `(function(){var b=document.currentScript&&document.currentScript.previousElementSibling,l=${JSON.stringify(
  {
    system: themeToggleLabel("system"),
    light: themeToggleLabel("light"),
    dark: themeToggleLabel("dark"),
  },
)},t=document.documentElement.getAttribute("data-theme"),s=l[t]||l.system;if(b){b.setAttribute("aria-label",s);b.setAttribute("title",s)}})()`;

/**
 * Inline <head> script: apply the stored choice before first paint so a
 * forced theme does not flash the OS one. localStorage can throw (blocked
 * storage, some private modes); fall back to "system" then.
 */
export const themeInitScript = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}document.documentElement.setAttribute("data-theme",t==="light"||t==="dark"?t:"system")})()`;
