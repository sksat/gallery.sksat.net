import { describe, expect, it } from "vitest";
import {
  chipPatch,
  keepChoices,
  storedChoices,
  tagState,
  withTargets,
  type TagChoices,
} from "./tag-visibility";

// film is public, secret is not.
const pub = new Set(["film"]);

describe("chipPatch", () => {
  it("saves only the public tags' chips switched since the page loaded", () => {
    expect(chipPatch({ film: true, night: false }, [], pub)).toEqual({
      film: "hidden",
    });
    expect(chipPatch({ film: false }, ["film"], pub)).toEqual({ film: null });
    // Nothing switched: nothing to save.
    expect(chipPatch({ film: true }, ["film"], pub)).toEqual({});
  });

  it("never makes a private tag public, even when the form says so", () => {
    expect(chipPatch({ secret: false }, ["secret"], pub)).toEqual({});
  });

  it("takes tags named like Object's own properties", () => {
    const loaded = JSON.parse('{"__proto__":true,"constructor":true}');
    const all = new Set(["__proto__", "constructor"]);
    const p = chipPatch(loaded, [], all);
    expect(Object.keys(p)).toEqual(["__proto__", "constructor"]);
    expect(JSON.stringify(p)).toBe(
      '{"__proto__":"hidden","constructor":"hidden"}',
    );
  });
});

describe("withTargets", () => {
  it("hides or shows only public tags the photo has and that are not so already", () => {
    expect(
      withTargets(
        { secret: "hidden" },
        ["film", "secret"],
        { film: false, secret: true, other: false },
        pub,
      ),
    ).toEqual({ film: "hidden", secret: "hidden" });
    expect(
      withTargets({ film: "hidden" }, ["film"], { film: true }, pub),
    ).toEqual({});
  });
});

describe("keepChoices / storedChoices / tagState", () => {
  it("keeps the choices of the tags listed; none is NULL", () => {
    expect(keepChoices({ a: "hidden", b: "hidden" }, ["b", "c"])).toEqual({
      b: "hidden",
    });
    expect(storedChoices({})).toBeNull();
    expect(storedChoices({ b: "hidden" })).toBe('{"b":"hidden"}');
  });

  it("says whether a tag is shown, hidden by the photo, or private", () => {
    expect(tagState("film", {}, pub)).toEqual({
      shown: true,
      own: false,
      locked: false,
    });
    expect(tagState("film", { film: "hidden" }, pub)).toEqual({
      shown: false,
      own: true,
      locked: false,
    });
    // A stored "shown" is no choice.
    expect(tagState("film", { film: "shown" }, pub)).toEqual({
      shown: true,
      own: false,
      locked: false,
    });
    const cases: TagChoices[] = [{}, { secret: "shown" }];
    for (const choices of cases) {
      expect(tagState("secret", choices, pub)).toEqual({
        shown: false,
        own: false,
        locked: true,
      });
    }
  });
});
