"use client";
/**
 * Zero-drift `@` reference recognition backdrop mirror (`<PromptHighlight>`).
 *
 * Uses the exact server `listReferenceMentions(prompt)` parser from `@/lib/brand-studio/enhancer/mentions`
 * so client highlighting and server reference binding match 100% across English (`@image1`, `@video1`,
 * `@audio1`, `image 2`), Korean (`@이미지1`, `이미지 1`, `영상 1`, `두 번째 사진`), lists (`이미지 1, 2`),
 * and bare `@N` tokens.
 *
 * Keeps 100% identical font metrics, spacing, padding, word-break, `pre-wrap` white-space, and scrollTop
 * sync with `.bs-prompt` (painting only `<mark>` background / dotted bottom border, never changing font
 * weight or horizontal padding) so multi-line Korean Hangul text and cursor never drift by even 0.5px.
 */
import type { RefObject } from "react";
import { listReferenceMentions, type MentionKind, type ReferenceMention } from "@/lib/brand-studio/enhancer/mentions";
import type { TrayItem } from "./refs";

export type PromptHighlightSegment =
  | { type: "text"; text: string; start: number }
  | { type: "mention"; text: string; start: number; bound: boolean; matchedKeys: string[] };

export interface ResolvedPromptMentions {
  segments: PromptHighlightSegment[];
  mentionedKeys: Set<string>;
}

function findTrayItemForMention(
  tray: readonly Pick<TrayItem, "key" | "kind">[],
  kind: MentionKind | "any",
  number: number,
): Pick<TrayItem, "key" | "kind"> | null {
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
        matchedKeys.push(hit.key);
        mentionedKeys.add(hit.key);
      } else {
        allBound = false;
      }
    }

    segments.push({
      type: "mention",
      text: prompt.slice(span.start, span.end),
      start: span.start,
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

export interface PromptHighlightProps {
  prompt: string;
  tray: readonly Pick<TrayItem, "key" | "kind">[];
  backdropRef?: RefObject<HTMLDivElement | null>;
}

export function PromptHighlight({ prompt, tray, backdropRef }: PromptHighlightProps) {
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
