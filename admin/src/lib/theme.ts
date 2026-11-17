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

/**
 * Inline <head> script: apply the stored choice before first paint so a
 * forced theme does not flash the OS one. localStorage can throw (blocked
 * storage, some private modes); fall back to "system" then.
 */
export const themeInitScript = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}document.documentElement.setAttribute("data-theme",t==="light"||t==="dark"?t:"system")})()`;
