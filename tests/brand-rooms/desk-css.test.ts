import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §4, from the desk checked in a browser (2026-11-18):
 *  - The review stage sat on the light token bridge app/(brand)/workspace.css puts on admin pages, mixed with
 *    its own dark fallbacks: the "팀 메모" tag was black on black. Its frame resets every token the stage reads
 *    so each var() takes the stage's own fallback, as on a page that never loaded that file.
 *  - The pinned day mark covered the first line's time in the desk's narrow conversation; it stays in the flow
 *    there, and the brand's conversation keeps its pinned mark.
 *  - In review mode the conversation is a 420px drawer from the left, hidden but kept when closed.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const review = read("components/brand-studio/review/review.css");
const chat = read("components/brand-rooms/chat/chat.css");

/** Declarations of every rule (outside @media) whose selector list includes `selector`. */
function rules(css: string, selector: string): string {
  const out: string[] = [];
  const flat = css.replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(selector)) out.push(m[2]!);
  }
  return out.join("\n");
}

describe("the review stage's frame on admin pages", () => {
  it("resets every --ys-* token the stage reads (but the console's own --ys-danger) to its fallback", () => {
    const read = new Set([...review.matchAll(/var\((--ys-[a-z-]+)/g)].map((m) => m[1]!));
    read.delete("--ys-danger");
    expect(read.size).toBeGreaterThan(10);
    const frame = rules(review, ".bsv-admin-frame");
    for (const token of read) expect(frame, token).toMatch(new RegExp(`${token}\\s*:\\s*initial\\s*;`));
    expect(frame).toMatch(/--bw-font\s*:\s*initial\s*;/);
    expect(frame).not.toMatch(/--ys-danger\s*:/);
  });
});

describe("the team-only switch", () => {
  it("keeps the hint's line while off, so turning it on never moves the checkbox", () => {
    expect(rules(review, ".bsv-team-hint[data-shown='false']")).toMatch(/visibility\s*:\s*hidden/);
    expect(rules(review, ".bsv-team-hint[data-shown='false']")).not.toMatch(/display\s*:\s*none/);
  });
});

describe("the desk's conversation", () => {
  it("keeps the day mark in the flow on the desk only", () => {
    expect(rules(chat, ".brc-desk-chat .brc-channel[data-layout='fill'] .brc-day")).toMatch(/position\s*:\s*static/);
    // The brand's own conversation is unchanged.
    expect(rules(chat, ".brc-channel[data-layout='fill'] .brc-day")).toMatch(/position\s*:\s*sticky/);
  });

  it("is a 420px drawer from the left in review mode, hidden but not removed when closed", () => {
    const drawer = rules(chat, ".brc-desk[data-desk-mode='review'] .brc-desk-chat");
    expect(drawer).toMatch(/position\s*:\s*fixed/);
    expect(drawer).toMatch(/left\s*:\s*0/);
    expect(drawer).toMatch(/width\s*:\s*min\(420px/);
    expect(drawer).toMatch(/visibility\s*:\s*hidden/);
    expect(drawer).not.toMatch(/display\s*:\s*none/);
    expect(rules(chat, ".brc-desk[data-desk-mode='review'] .brc-desk-chat[data-open='true']")).toMatch(/visibility\s*:\s*visible/);
    // Open, a light scrim sits under the drawer and over everything else (fixed, so the page still scrolls).
    const scrim = rules(chat, ".brc-desk-scrim");
    expect(scrim).toMatch(/position\s*:\s*fixed/);
    expect(scrim).toMatch(/inset\s*:\s*0/);
    expect(Number(scrim.match(/z-index\s*:\s*(\d+)/)?.[1])).toBeLessThan(Number(drawer.match(/z-index\s*:\s*(\d+)/)?.[1]));
    // The stage is in page flow: no fixed height or inner scroll around it.
    const main = rules(chat, ".brc-desk[data-desk-mode='review'] .brc-desk-main");
    expect(main).toMatch(/overflow\s*:\s*visible/);
    expect(rules(chat, ".brc-admin-room.brc-desk[data-desk-mode='review']")).toMatch(/height\s*:\s*auto/);
  });
});
