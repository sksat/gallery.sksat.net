import { describe, expect, it } from "vitest";
import {
  nextTheme,
  parseTheme,
  themeInitScript,
  themeToggleLabel,
  themeToggleLabelScript,
} from "./theme";

describe("parseTheme", () => {
  it("keeps the explicit choices", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });

  it("falls back to system for missing or junk values", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("DARK")).toBe("system");
  });
});

describe("nextTheme", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});

describe("themeToggleLabel", () => {
  it("names the current mode and the next one", () => {
    expect(themeToggleLabel("system")).toBe("Theme: System (switch to Light)");
    expect(themeToggleLabel("dark")).toBe("Theme: Dark (switch to System)");
  });
});

describe("themeToggleLabelScript", () => {
  const run = (theme: string | null, hasButton = true) => {
    const attrs: Record<string, string> = {};
    const button = {
      setAttribute: (k: string, v: string) => (attrs[k] = v),
    };
    const fakeDocument = {
      currentScript: { previousElementSibling: hasButton ? button : null },
      documentElement: { getAttribute: () => theme },
    };
    new Function("document", themeToggleLabelScript)(fakeDocument);
    return attrs;
  };

  it("labels the button with the applied theme", () => {
    expect(run("light")).toEqual({
      "aria-label": "Theme: Light (switch to Dark)",
      title: "Theme: Light (switch to Dark)",
    });
  });

  it("treats a missing or unknown attribute as system", () => {
    expect(run(null)["aria-label"]).toBe("Theme: System (switch to Light)");
    expect(run("bogus")["aria-label"]).toBe("Theme: System (switch to Light)");
  });

  it("does nothing without a button", () => {
    expect(run("dark", false)).toEqual({});
  });
});

describe("themeInitScript", () => {
  const run = (getItem: () => string | null) => {
    const attrs: Record<string, string> = {};
    const fakeDocument = {
      documentElement: {
        setAttribute: (k: string, v: string) => (attrs[k] = v),
      },
    };
    new Function("localStorage", "document", themeInitScript)(
      { getItem },
      fakeDocument,
    );
    return attrs["data-theme"];
  };

  it("applies the stored theme", () => {
    expect(run(() => "dark")).toBe("dark");
  });

  it("defaults to system when nothing is stored", () => {
    expect(run(() => null)).toBe("system");
  });

  it("survives storage that throws", () => {
    expect(
      run(() => {
        throw new Error("SecurityError");
      }),
    ).toBe("system");
  });
});
