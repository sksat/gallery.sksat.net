import { describe, expect, it } from "vitest";
import { nextTheme, parseTheme, themeInitScript } from "./theme";

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
