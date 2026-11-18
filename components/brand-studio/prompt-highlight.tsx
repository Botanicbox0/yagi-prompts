"use client";
/**
 * The prompt field's painted layer (`<PromptHighlight>`): the words the member reads, with every
 * reference mention marked in place.
 *
 * Mentions come from the server's own parser (`listReferenceMentions`, lib/brand-studio/enhancer/mentions),
 * so what is highlighted is exactly what the server binds: "@image1", "image 2", "Figure 1", "이미지 1",
 * "두 번째 사진", lists ("이미지 1, 2") and a bare "@N". A kind word with N is the Nth reference of that
 * kind in tray order; a bare "@N" is the Nth chip.
 *
 * Why the marks cannot drift (2026-11-19): this layer draws the glyphs itself, and the `<textarea>`
 * above it keeps only the caret, the selection and typing (its text is transparent). A mark is a run of
 * the same text it highlights, so it can only ever sit on its own letters. Both layers sit in one grid
 * cell inside one scroller (studio-v2.css `.bs-prompt-stack`), so they also share their width by
 * construction: neither has a scrollbar of its own, and the caret wraps exactly where the words do.
 * Marks paint with background, box-shadow and an underline only; nothing that takes inline space.
 */
import type { RefObject } from "react";
import { listReferenceMentions, type MentionKind, type ReferenceMention } from "@/lib/brand-studio/enhancer/mentions";
import type { TrayItem } from "./refs";

export type PromptHighlightSegment =
  | { type: "text"; text: string; start: number }
  | {
      type: "mention";
      text: string;
      /** UTF-16 offsets into the prompt, the parser's own units: `prompt.slice(start, end) === text`. */
      start: number;
      end: number;
      /** Every number in the span points at a tray item. */
      bound: boolean;
      /** The tray keys it points at, in the order the span names them. */
      matchedKeys: string[];
    };

export type PromptMentionSegment = Extract<PromptHighlightSegment, { type: "mention" }>;

export interface ResolvedPromptMentions {
  segments: PromptHighlightSegment[];
  mentionedKeys: Set<string>;
}

/** The tray item a mention names: per kind in tray order, or the Nth chip for a bare "@N". */
export function findTrayItemForMention<T extends Pick<TrayItem, "key" | "kind">>(
  tray: readonly T[],
  kind: MentionKind | "any",
  number: number,
): T | null {
  if (number < 1) return null;
  if (kind === "any") return tray[number - 1] ?? null;
  let seen = 0;
  for (const item of tray) {
    if (item.kind !== kind) continue;
    seen += 1;
    if (seen === number) return item;
  }
  return null;
}

/**
 * Splits `prompt` into plain-text and mention segments using `listReferenceMentions(prompt)` and
 * resolves which `tray` item keys are referenced.
 */
export function resolvePromptMentions(
  prompt: string,
  tray: readonly Pick<TrayItem, "key" | "kind">[],
): ResolvedPromptMentions {
  const mentionedKeys = new Set<string>();
  if (!prompt) {
    return { segments: [], mentionedKeys };
  }

  const rawMentions = listReferenceMentions(prompt);
  if (rawMentions.length === 0) {
    return {
      segments: [{ type: "text", text: prompt, start: 0 }],
      mentionedKeys,
    };
  }

  // Group mentions that share a single text span (e.g. "이미지 1, 2" or "images 1-3").
  const grouped = new Map<string, { start: number; end: number; items: ReferenceMention[] }>();
  for (const mention of rawMentions) {
    const spanKey = `${mention.start}:${mention.end}`;
    const existing = grouped.get(spanKey);
    if (existing) {
      existing.items.push(mention);
    } else {
      grouped.set(spanKey, { start: mention.start, end: mention.end, items: [mention] });
    }
  }

  const orderedSpans = [...grouped.values()].sort((a, b) => a.start - b.start);
  const segments: PromptHighlightSegment[] = [];
  let cursor = 0;

  for (const span of orderedSpans) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      segments.push({
        type: "text",
        text: prompt.slice(cursor, span.start),
        start: cursor,
      });
    }

    const matchedKeys: string[] = [];
    let allBound = span.items.length > 0;
    for (const m of span.items) {
      const hit = findTrayItemForMention(tray, m.kind, m.number);
      if (hit) {
        if (!matchedKeys.includes(hit.key)) matchedKeys.push(hit.key);
        mentionedKeys.add(hit.key);
      } else {
        allBound = false;
      }
    }

    segments.push({
      type: "mention",
      text: prompt.slice(span.start, span.end),
      start: span.start,
      end: span.end,
      bound: allBound,
      matchedKeys,
    });
    cursor = span.end;
  }

  if (cursor < prompt.length) {
    segments.push({
      type: "text",
      text: prompt.slice(cursor),
      start: cursor,
    });
  }

  return { segments, mentionedKeys };
}

/** The mention the caret sits in or at the edge of (a collapsed selection), or null. */
export function mentionAtCaret(segments: readonly PromptHighlightSegment[], caret: number): PromptMentionSegment | null {
  for (const seg of segments) if (seg.type === "mention" && caret >= seg.start && caret <= seg.end) return seg;
  return null;
}

export interface PromptHighlightProps {
  prompt: string;
  tray: readonly Pick<TrayItem, "key" | "kind">[];
  backdropRef?: RefObject<HTMLDivElement | null>;
  /** A tray key being pointed at (its thumbnail is hovered or focused): its mentions are emphasised. */
  linkedKey?: string | null;
  /** The mention under the pointer or the caret (its `start`): emphasised with its thumbnail. */
  activeStart?: number | null;
}

export function PromptHighlight({ prompt, tray, backdropRef, linkedKey = null, activeStart = null }: PromptHighlightProps) {
  const { segments } = resolvePromptMentions(prompt, tray);
  // When `prompt` ends with `\n`, `segments` already ends with `\n`; appending a single space produces
  // trailing `\n ` so CSS `pre-wrap` reserves the exact trailing blank line height of `<textarea>`.
  const needsTrailingSpace = prompt.endsWith("\n");

  return (
    <div
      ref={backdropRef}
      aria-hidden="true"
      className="bs-prompt-backdrop"
      data-prompt-highlight=""
    >
      {segments.map((seg) =>
        seg.type === "mention" ? (
          <mark
            key={`m-${seg.start}`}
            className="bs-mention-mark"
            data-mention-bound={seg.bound ? "true" : "false"}
            data-mention-start={seg.start}
            data-mention-keys={seg.matchedKeys.join(" ") || undefined}
            data-linked={
              activeStart === seg.start || (linkedKey !== null && seg.matchedKeys.includes(linkedKey)) ? "" : undefined
            }
          >
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
      {needsTrailingSpace ? " " : null}
    </div>
  );
}
