import { describe, expect, it } from "vitest";
import { breakLines, fontShorthand, graphemes, layoutText, lineWidth, type TextStyle } from "@/components/brand-studio/layers/text-layout";

/** Every character is 10 px wide: easy arithmetic, same rule the browser measurer follows per glyph. */
const mono = (text: string) => graphemes(text).length * 10;

const style = (over: Partial<TextStyle> = {}): TextStyle => ({
  text: "",
  w: 100,
  size: 20,
  lineHeight: 1.5,
  letterSpacing: 0,
  align: "left",
  plate: null,
  ...over,
});

describe("line breaking", () => {
  it("breaks on spaces and keeps words whole", () => {
    // "aaaa bbbb" is 90 px; "aaaa bbbb cc" would be 120 px.
    expect(breakLines("aaaa bbbb cc", 100, mono, 0)).toEqual(["aaaa bbbb", "cc"]);
  });

  it("keeps Korean words whole and breaks a word longer than the box between characters", () => {
    expect(breakLines("새로운 향수 컬렉션", 60, mono, 0)).toEqual(["새로운 향수", "컬렉션"]);
    expect(breakLines("abcdefghijkl", 50, mono, 0)).toEqual(["abcde", "fghij", "kl"]);
    expect(breakLines("ab abcdefghijkl", 50, mono, 0)).toEqual(["ab", "abcde", "fghij", "kl"]);
  });

  it("keeps hard line breaks and empty lines", () => {
    expect(breakLines("one\n\ntwo", 200, mono, 0)).toEqual(["one", "", "two"]);
    expect(breakLines("", 200, mono, 0)).toEqual([""]);
  });

  it("counts letter spacing once per character, like CSS", () => {
    expect(lineWidth("abc", mono, 2)).toBe(36);
    expect(lineWidth("", mono, 2)).toBe(0);
    // With 2 px spacing "aaaa bbbb" is 108 px and no longer fits 100.
    expect(breakLines("aaaa bbbb", 100, mono, 2)).toEqual(["aaaa", "bbbb"]);
  });

  it("counts a Hangul syllable or an emoji as one character", () => {
    expect(graphemes("한글")).toHaveLength(2);
    expect(graphemes("👍🏽a")).toHaveLength(2);
  });
});

describe("layout", () => {
  it("stacks lines by the line height and aligns each line in the box", () => {
    const left = layoutText(style({ text: "aaaa bbbb cc" }), mono);
    expect(left.lines.map((l) => [l.text, l.x, l.width])).toEqual([
      ["aaaa bbbb", 0, 90],
      ["cc", 0, 20],
    ]);
    expect(left.lineHeightPx).toBe(30);
    expect(left.height).toBe(60);
    const centre = layoutText(style({ text: "aaaa bbbb cc", align: "center" }), mono);
    expect(centre.lines[1]!.x).toBe(40);
    const right = layoutText(style({ text: "aaaa bbbb cc", align: "right" }), mono);
    expect(right.lines[1]!.x).toBe(80);
  });

  it("takes the background plate's padding off the width and adds it to the height", () => {
    const plain = layoutText(style({ text: "aaaa bbbb", w: 100 }), mono);
    expect(plain.lines).toHaveLength(1);
    const plated = layoutText(style({ text: "aaaa bbbb", w: 100, plate: { color: "#FFFFFF", padding: 0.5, radius: 0 } }), mono);
    expect(plated.pad).toBe(10);
    expect(plated.contentWidth).toBe(80);
    expect(plated.lines.map((l) => l.text)).toEqual(["aaaa", "bbbb"]);
    expect(plated.height).toBe(2 * 30 + 20);
  });

  it("gives an empty text one line of height", () => {
    expect(layoutText(style({ text: "" }), mono).height).toBe(30);
  });

  it("writes the canvas font shorthand with a resolved family", () => {
    expect(fontShorthand({ weight: 700, size: 48 }, "'Pretendard Variable', sans-serif")).toBe("700 48px 'Pretendard Variable', sans-serif");
  });
});
