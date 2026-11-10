import { describe, expect, it } from "vitest";
import { isLight, normalizeHex, pushRecent } from "@/components/brand-studio/layers/colors";
import { SWATCHES } from "@/components/brand-studio/layers/model";
import { COLOUR } from "@/lib/design/identity";

describe("colours", () => {
  it("spells every colour one way", () => {
    expect(normalizeHex("#3875c5")).toBe("#3875C5");
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex(" #FfF ")).toBe("#FFFFFF");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("blue")).toBeNull();
  });

  it("keeps recent colours unique, newest first, capped", () => {
    expect(pushRecent(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(pushRecent(["#111111"], "nope")).toEqual(["#111111"]);
    expect(pushRecent(["#111111", "#222222", "#333333"], "#abcdef", 3)).toEqual(["#ABCDEF", "#111111", "#222222"]);
  });

  it("offers black, white and the identity blue", () => {
    expect(SWATCHES.blue).toBe(COLOUR.accent.toUpperCase());
    expect(isLight(SWATCHES.white)).toBe(true);
    expect(isLight(SWATCHES.black)).toBe(false);
    expect(isLight(SWATCHES.blue)).toBe(false);
  });
});
