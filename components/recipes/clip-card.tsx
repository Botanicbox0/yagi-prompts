'use client';

import { useState } from 'react';
import { CopyPrompt } from './copy-prompt';

/**
 * Shared prompt & clip card (docs/HANDOFF-2026-11-26-MAKER-BLOG.md §2, Batch 1):
 *   Number + Title → optional one-line specs (meta) → prominent Tip box (above prompt) →
 *   Prompt folded to ~6 lines with "전체 보기 / 접기" → Copy button.
 *
 * Strictly uses TWINGS v2 white-surface identity tokens (docs/design/IDENTITY.md §2-1).
 */

export const CLIP_FOLD_LINES = 6;
export const CLIP_FOLD_CHARS = 360;

export function isFoldablePrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > CLIP_FOLD_CHARS) return true;
  return trimmed.split(/\r?\n/).length > CLIP_FOLD_LINES;
}

export interface ClipCardLabels {
  tipHeading: string;
  expand: string;
  collapse: string;
  copy: string;
  copied: string;
}

export interface ClipCardProps {
  id?: string;
  number?: number;
  showNumber?: boolean;
  title: string;
  meta?: string | null;
  note?: string | null;
  noteMarker?: 'step' | 'guide';
  prompt: string;
  labels: ClipCardLabels;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  showCopy?: boolean;
  as?: 'li' | 'article';
  itemAttr?: {
    'data-recipe-how-step'?: number;
    'data-recipe-guide-step'?: number;
  };
}

const COPY_PILL =
  'inline-flex min-h-9 shrink-0 items-center rounded-full border border-[#09090B]/[0.12] bg-white px-3.5 text-xs font-medium text-[#09090B] transition-colors hover:bg-[#F4F4F5]';

export function ClipCard({
  id,
  number,
  showNumber = true,
  title,
  meta = null,
  note = null,
  noteMarker = 'guide',
  prompt,
  labels,
  compact = false,
  expanded,
  onToggle,
  showCopy = true,
  as = 'li',
  itemAttr,
}: ClipCardProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = expanded !== undefined;
  const isOpen = controlled ? expanded : internalOpen;
  const foldable = isFoldablePrompt(prompt);
  const folded = foldable && !isOpen;
  const cleanMeta = meta?.trim() || null;
  const cleanNote = note?.trim() || null;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
      return;
    }
    if (!controlled) {
      setInternalOpen((value) => !value);
    }
  };

  const noteAttr = noteMarker === 'step' ? { 'data-recipe-note': '' } : { 'data-recipe-guide-note': '' };
  const Tag = as;

  return (
    <Tag
      id={id}
      {...itemAttr}
      className={`scroll-mt-28 rounded-[16px] border border-[#09090B]/[0.08] bg-white ${compact ? 'p-4' : 'p-5'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            {showNumber && number !== undefined ? (
              <span
                data-clip-number
                className="inline-flex shrink-0 items-center rounded-full bg-[#F4F4F5] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#09090B]"
              >
                {String(number).padStart(2, '0')}
              </span>
            ) : null}
            <h3 className="min-w-0 break-keep text-[15px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#09090B] sm:text-base">
              {title}
            </h3>
          </div>
          {cleanMeta ? (
            <p className="mt-1.5 break-keep text-xs font-medium tabular-nums text-[#71717A]">{cleanMeta}</p>
          ) : null}
        </div>
        {showCopy ? (
          <CopyPrompt text={prompt} label={labels.copy} done={labels.copied} className={COPY_PILL} />
        ) : null}
      </div>

      {cleanNote ? (
        <div
          {...noteAttr}
          className="relative mt-3.5 overflow-hidden rounded-xl border border-[#09090B]/[0.08] bg-[#F4F4F5] py-3 pl-4 pr-4"
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-[#09090B]" />
          <p className="text-xs font-semibold tracking-[-0.01em] text-[#09090B]">{labels.tipHeading}</p>
          <p className="mt-1 whitespace-pre-line break-keep text-sm leading-relaxed text-[#09090B]">{cleanNote}</p>
        </div>
      ) : null}

      <div className="relative mt-3.5">
        <p
          data-recipe-prompt={folded ? 'folded' : undefined}
          className={`whitespace-pre-wrap break-words text-sm leading-[1.6] text-[#52525B] ${folded ? 'max-h-[9.6em] overflow-hidden' : ''}`}
        >
          {prompt}
        </p>
        {folded ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent"
          />
        ) : null}
      </div>

      {foldable ? (
        <button
          type="button"
          data-recipe-expand
          aria-expanded={isOpen}
          onClick={handleToggle}
          className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-[#09090B] underline decoration-[#09090B]/30 underline-offset-4 transition-colors hover:decoration-[#09090B]"
        >
          {isOpen ? labels.collapse : labels.expand}
        </button>
      ) : null}
    </Tag>
  );
}
