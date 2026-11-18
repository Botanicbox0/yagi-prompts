import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trayVirtualTags } from "@/components/brand-studio/at-mention-menu";
import { Dock, type DockProps } from "@/components/brand-studio/dock";
import { initialDraft } from "@/components/brand-studio/dock-model";
import { PromptHighlight, findTrayItemForMention, mentionAtCaret, resolvePromptMentions, type PromptMentionSegment } from "@/components/brand-studio/prompt-highlight";
import { trayItemFromAsset, trayLabels, type TrayItem } from "@/components/brand-studio/refs";
import { listReferenceMentions } from "@/lib/brand-studio/enhancer/mentions";
import { bindReferences, resolveMention } from "@/lib/brand-studio/enhancer/references";
import type { EnhanceReference } from "@/lib/brand-studio/enhancer/types";
import { allowance, asset, copyFor } from "./fixtures";

/**
 * The prompt field's reference highlights (2026-11-19). The founder's case: after 설계하기 with two
 * pictures, "Figure 2" and "Figure 1" on the third line were boxed over "und of Fi" and "ender Fi".
 * Measured cause: the textarea reserved a 15 px scrollbar gutter the mirror did not (811 vs 826 px
 * client width), so line 2 broke after "Keep the bottle," in the field and after "liquid," in the mirror.
 */
const LONG =
  "A centered photograph of the rounded clear glass perfume bottle from Figure 2, filled with amber liquid and topped with its matte terracotta pebble cap, with the front mark replaced by the exact stylized bunny logo from Figure 1. Keep the bottle, liquid, reflective surface, and blurred blue-and-amber background of Figure 2 unchanged. Render Figure 1 unredrawn in the same centered position, size, and frosted etched-glass finish, matching the reflection below. Soft studio light catches the curved glass and frosted etching, creating a clean editorial mood.";

const logo = trayItemFromAsset(asset(1, { role: "logo" }));
const bottle = trayItemFromAsset(asset(2, { role: "product" }));
const clip = trayItemFromAsset(asset(3, { kind: "video", seconds: 6 }));
const mentions = (prompt: string, tray: readonly TrayItem[]) =>
  resolvePromptMentions(prompt, tray).segments.filter((s): s is PromptMentionSegment => s.type === "mention");

/** Every offset is a UTF-16 index the parser itself produced, and the segments rebuild the prompt exactly. */
function expectExactSegments(prompt: string, tray: readonly TrayItem[]) {
  const { segments } = resolvePromptMentions(prompt, tray);
  expect(segments.map((s) => s.text).join("")).toBe(prompt);
  let cursor = 0;
  for (const seg of segments) {
    expect(seg.start).toBe(cursor);
    expect(prompt.slice(seg.start, seg.start + seg.text.length)).toBe(seg.text);
    if (seg.type === "mention") expect(seg.end).toBe(seg.start + seg.text.length);
    cursor += seg.text.length;
  }
  const spans = [...new Map(listReferenceMentions(prompt).map((m) => [`${m.start}:${m.end}`, m])).values()];
  expect(segments.filter((s) => s.type === "mention").map((s) => [s.start, (s as PromptMentionSegment).end])).toEqual(spans.map((m) => [m.start, m.end]));
}

describe("segments (offsets in the parser's UTF-16 units)", () => {
  it("the founder's designed sentence: four mentions, each on its own letters, all bound", () => {
    expectExactSegments(LONG, [logo, bottle]);
    const found = mentions(LONG, [logo, bottle]);
    expect(found.map((m) => [m.text, m.start, m.bound, m.matchedKeys])).toEqual([
      ["Figure 2", LONG.indexOf("Figure 2"), true, [bottle.key]],
      ["Figure 1", LONG.indexOf("Figure 1"), true, [logo.key]],
      ["Figure 2", LONG.indexOf("Figure 2", LONG.indexOf("Figure 1")), true, [bottle.key]],
      ["Figure 1", LONG.lastIndexOf("Figure 1"), true, [logo.key]],
    ]);
  });

  it("Korean, mixed and list forms", () => {
    const ko = "2번 이미지에서 인물 얼굴을 1번 이미지의 로고로 전부 변경";
    expectExactSegments(ko, [logo, bottle]);
    expect(mentions(ko, [logo, bottle]).map((m) => [m.text, m.matchedKeys])).toEqual([["2번 이미지", [bottle.key]], ["1번 이미지", [logo.key]]]);
    const mixed = "@image1 로고를 두 번째 사진의 병에, Figure 2 배경은 그대로, image 1 크기 유지";
    expectExactSegments(mixed, [logo, bottle]);
    expect(mentions(mixed, [logo, bottle]).map((m) => m.matchedKeys)).toEqual([[logo.key], [bottle.key], [bottle.key], [logo.key]]);
    const list = "Use images 1, 2 and 이미지 1과 2 together";
    expectExactSegments(list, [logo, bottle]);
    expect(mentions(list, [logo, bottle]).map((m) => [m.text, m.matchedKeys])).toEqual([["images 1, 2", [logo.key, bottle.key]], ["이미지 1과 2", [logo.key, bottle.key]]]);
  });

  it("emoji and combining marks before a mention keep the offsets in UTF-16 units", () => {
    const text = "😀👩🏽‍🎨 café Figure 1 → Figure 2 ✨ 이미지 1";
    expectExactSegments(text, [logo, bottle]);
    const found = mentions(text, [logo, bottle]);
    expect(found[0]!.start).toBe(text.indexOf("Figure 1"));
    expect(found[1]!.start).toBe(text.indexOf("Figure 2"));
    expect(found[2]!.start).toBe(text.indexOf("이미지 1"));
    // The painted layer carries the same offsets and the same characters.
    const html = renderToStaticMarkup(<PromptHighlight prompt={text} tray={[logo, bottle]} />);
    for (const m of found) expect(html).toContain(`data-mention-start="${m.start}" data-mention-keys="${m.matchedKeys.join(" ")}">${m.text}</mark>`);
  });

  it("counts and sizes are not mentions", () => {
    expect(mentions("이미지 2장, 16:9, 영상 15초, image 1080p", [logo, bottle])).toEqual([]);
  });
});

describe("binding (kind-aware, the same as the server's)", () => {
  it("Figure N / image N / @imageN / 이미지 N / ordinal forms name the Nth IMAGE, a bare @N the Nth chip", () => {
    const tray = [clip, logo, bottle];
    for (const text of ["Figure 1", "image 1", "@image1", "이미지 1", "첫 번째 사진", "1번 이미지"]) {
      expect(mentions(text, tray)[0]?.matchedKeys).toEqual([logo.key]);
    }
    expect(mentions("Figure 2", tray)[0]?.matchedKeys).toEqual([bottle.key]);
    expect(mentions("@1", tray)[0]?.matchedKeys).toEqual([clip.key]);
    expect(mentions("영상 1", tray)[0]?.matchedKeys).toEqual([clip.key]);
  });

  it("what the field shows is what the server binds for the model, mention by mention", () => {
    const cases: Array<{ tray: TrayItem[]; profile: "seedream" | "nano-banana" | "gpt-image" | "seedance"; kind: "image" | "video" }> = [
      { tray: [logo, bottle], profile: "seedream", kind: "image" },
      { tray: [logo, bottle], profile: "gpt-image", kind: "image" },
      { tray: [clip, logo, bottle], profile: "seedance", kind: "video" },
    ];
    const text = `${LONG} @image2 @1 두 번째 이미지 image 1 영상 1`;
    for (const c of cases) {
      const refs: EnhanceReference[] = c.tray.map((item, i) => ({ index: i + 1, kind: item.kind, label: item.name }));
      const binding = bindReferences({ kind: c.kind, profile: c.profile, references: refs });
      for (const m of listReferenceMentions(text)) {
        const server = resolveMention(binding.bound, m.kind, m.number);
        const client = findTrayItemForMention(c.tray, m.kind, m.number);
        expect(client?.key ?? null).toBe(server ? c.tray[server.position - 1]!.key : null);
      }
    }
  });

  it("a mention that points at nothing stays unbound (its own style), and the caret finds the mention it sits in", () => {
    const text = "Figure 1 and Figure 3";
    const found = mentions(text, [logo, bottle]);
    expect(found.map((m) => [m.text, m.bound])).toEqual([["Figure 1", true], ["Figure 3", false]]);
    const html = renderToStaticMarkup(<PromptHighlight prompt={text} tray={[logo, bottle]} />);
    expect(html).toContain(`data-mention-bound="false" data-mention-start="13">Figure 3</mark>`);
    const { segments } = resolvePromptMentions(text, [logo, bottle]);
    expect(mentionAtCaret(segments, 0)?.text).toBe("Figure 1");
    expect(mentionAtCaret(segments, 8)?.text).toBe("Figure 1");
    expect(mentionAtCaret(segments, 10)).toBeNull();
    expect(mentionAtCaret(segments, 16)?.text).toBe("Figure 3");
  });

  it("the thumbnail label is the name a mention is linked to (@image1 under the first picture)", () => {
    expect(trayVirtualTags([clip, logo, bottle])).toEqual(["@video1", "@image1", "@image2"]);
  });
});

describe("the field's structure makes drift impossible", () => {
  const css = readFileSync(path.resolve(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
  /** The rule that starts a line with exactly this selector. */
  const rule = (selector: string) => {
    const at = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`, "m"));
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  const declarations = (block: string) =>
    block
      .slice(block.indexOf("{") + 1, block.lastIndexOf("}"))
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()] as const);

  it("one scroller, one grid cell, no scrollbar of either layer's own, glyphs painted by the mirror", () => {
    expect(rule(".bs-prompt-scroll")).toMatch(/max-height: 164px;.*overflow-y: auto;.*scrollbar-gutter: stable/);
    expect(rule(".bs-prompt-stack")).toContain("display: grid");
    expect(rule(".bs-prompt, .bs-prompt-backdrop")).toContain("grid-area: 1 / 1");
    expect(rule(".bs-prompt-backdrop")).toMatch(/overflow: hidden;.*color: var\(--ys-ink\)/);
    const field = rule(".bs-prompt");
    expect(field).toMatch(/color: transparent;.*caret-color: var\(--ys-ink\)/);
    expect(field).toContain("overflow: hidden");
    expect(field).not.toContain("field-sizing");
    expect(css).not.toMatch(/\.bs-prompt-backdrop \{[^}]*scrollbar-width: none/);
    // Selection stays visible over the painted words; IME composition and high contrast fall back to the field.
    expect(rule(".bs-prompt::selection")).toMatch(/background: color-mix\(.*\);.*color: transparent/);
    expect(css).toMatch(/\.bs-prompt-wrap\[data-composing\] \.bs-prompt \{ color: var\(--ys-ink\); \}/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.bs-prompt-backdrop \{ visibility: hidden; \}\s*\.bs-prompt \{ color: CanvasText;/);
  });

  it("marks never take inline space", () => {
    const blocks = css.match(/^\.bs-mention-mark[^{]*\{[^}]*\}/gm) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      for (const [prop, value] of declarations(block)) {
        if (/^(padding|margin|border)(-left|-right|-inline.*)?$/.test(prop)) expect(value, `${prop} in ${block}`).toBe("0");
        if (prop === "letter-spacing" || prop === "font") expect(value).toBe("inherit");
        expect(prop).not.toMatch(/^(font-weight|font-size|word-spacing)$/);
      }
    }
  });

  it("the dock renders the two layers in one stack, with a tooltip line for the caret's mention", () => {
    const copy = copyFor("ko");
    const props: DockProps = {
      draft: { ...initialDraft(), prompt: LONG },
      tray: [logo, bottle],
      labels: trayLabels([logo, bottle], copy),
      copy,
      locale: "ko",
      allowance: allowance(),
      credits: 9,
      busy: false,
      message: null,
      film: null,
      uploading: [],
      onDraft: () => {},
      onTrayUpdate: () => {},
      onTrayRemove: () => {},
      onSubmit: () => {},
      onDropSource: () => {},
      onFiles: () => {},
      onBrowse: () => {},
    };
    const html = renderToStaticMarkup(<Dock {...props} />);
    expect(html.match(/<mark /g)).toHaveLength(4);
    expect(html).toMatch(/<div class="bs-prompt-stack"><div aria-hidden="true" class="bs-prompt-backdrop"/);
    expect(html).toContain("data-mention-live");
    expect(html.match(/data-mentioned=""/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
