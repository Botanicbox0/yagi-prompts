'use client';

import { useEffect, useState } from 'react';
import { captureFrames } from '@/lib/media/capture-frames';
import { formatClock } from '@/lib/prompts/keyframes';
import type { TemplatePartView } from '@/lib/template-director/parts-view';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — "what this template decides", under the example video on the template page.
 * A buyer cannot retry a film for free, so before paying they see each part the template fixes: a frame taken from the
 * example video, the part's name, a short description, where in the video it shows and that it cannot be changed.
 * Tapping a part with a range replays just that range (the player owns the loop: `onSelect`).
 *
 * One quiet row on the white surface, three techniques: the wash panel the keyframe strip uses, tabular numerals for
 * the ranges, an ink ring for the pressed part (pink stays on the pay button). No words of the template's prompt
 * reach this component: it gets names from the public lock and styling projections and the admin's descriptions only.
 * Each part says its state (§3.4.9): "can't be changed", "template style" (the make card lets the buyer keep their own
 * hair or makeup instead) or "from your photo".
 */

export interface TemplateFixedCopy {
  heading: string;
  hint: string;
  wholeVideo: string;
  locked: string;
  /** docs/PERSONAL-STUDIO.md §3.4.9 (S2): a part the template styles (the buyer may keep their own) and one from the photo. */
  styled?: string;
  photo?: string;
  /** A lock block that did not parse fixes everything: one line instead of the parts. */
  lockedAll: string;
}

export interface TemplateFixedStripProps {
  parts: readonly TemplatePartView[];
  all?: boolean;
  copy: TemplateFixedCopy;
  /** The example clip the frames are taken from; without it the row is text only and nothing is tappable. */
  videoSrc?: string | null;
  aspect?: string | null;
  /** The part whose range is looping now. */
  activeId?: string | null;
  onSelect?: (part: TemplatePartView) => void;
}

/**
 * "0:03–0:07" (the whole seconds that enclose the range: 3.2–6.4 s, and 8.25–8.75 s reads "0:08–0:09", never
 * "0:08–0:08"), "0:03" for a range with no end, the whole-video words, or null for a shot range (its name says where).
 */
export function fixedRangeText(part: TemplatePartView, copy: Pick<TemplateFixedCopy, 'wholeVideo'>): string | null {
  if (part.from !== null) {
    if (part.to === null) return formatClock(part.from);
    const end = Math.max(Math.ceil(part.to), Math.floor(part.from) + 1);
    return `${formatClock(part.from)}–${formatClock(end)}`;
  }
  return part.key.startsWith('shots-') ? null : copy.wholeVideo;
}

function thumbAspectClass(aspect?: string | null): string {
  switch (aspect) {
    case '9:16':
      return 'aspect-[9/16]';
    case '3:4':
      return 'aspect-[3/4]';
    case '4:5':
      return 'aspect-[4/5]';
    case '1:1':
      return 'aspect-square';
    case '4:3':
      return 'aspect-[4/3]';
    default:
      return 'aspect-video';
  }
}

export function TemplateFixedStrip({ parts, all = false, copy, videoSrc = null, aspect = null, activeId = null, onSelect }: TemplateFixedStripProps) {
  const [frames, setFrames] = useState<Record<string, string>>({});
  const timed = parts.filter((part) => part.from !== null);
  const timesKey = timed.map((part) => `${part.id}@${part.from}`).join('|');

  useEffect(() => {
    if (!videoSrc || timed.length === 0) return;
    const controller = new AbortController();
    void captureFrames(videoSrc, timed.map((part) => part.from!), { signal: controller.signal }).then((captured) => {
      if (controller.signal.aborted) return;
      const next: Record<string, string> = {};
      timed.forEach((part, i) => {
        const frame = captured[i];
        if (frame) next[part.id] = frame;
      });
      setFrames(next);
    });
    return () => controller.abort();
    // `timesKey` stands for `timed`: a new array each render with the same parts must not recapture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSrc, timesKey]);

  if (!all && parts.length === 0) return null;
  const interactive = Boolean(videoSrc && onSelect);
  const tappable = interactive && timed.length > 0;
  const thumbClass = thumbAspectClass(aspect);

  return (
    <section data-template-fixed aria-label={copy.heading} className="w-full rounded-[16px] bg-[#F4F4F5] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-tight text-[#09090B]">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          {copy.heading}
        </p>
        {tappable && <p className="text-[0.7rem] text-[#71717A]">{copy.hint}</p>}
      </div>
      {all ? (
        <p data-template-fixed-all className="mt-2 text-[13px] leading-[1.5] break-keep text-[#09090B]">
          {copy.lockedAll}
        </p>
      ) : (
        <ul className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {parts.map((part) => {
            const range = fixedRangeText(part, copy);
            const frame = frames[part.id] ?? null;
            const pressed = activeId === part.id;
            const state = part.state === 'locked' ? copy.locked : part.state === 'styled' ? copy.styled ?? null : copy.photo ?? null;
            const body = (
              <>
                {frame && (
                  <span className={`relative h-[4.5rem] shrink-0 overflow-hidden rounded-[8px] bg-[#E4E4E7] ${thumbClass}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a frame drawn from the example video (data URL) */}
                    <img src={frame} alt="" decoding="async" className="h-full w-full object-cover" />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#09090B]">{part.label}</span>
                    {state && <span data-fixed-state={part.state} className="text-xs text-[#71717A]">{state}</span>}
                  </span>
                  {part.desc && <span className="text-xs leading-[1.45] break-keep text-[#52525B]">{part.desc}</span>}
                  {range && <span className="text-xs font-medium text-[#71717A] tabular-nums">{range}</span>}
                </span>
              </>
            );
            const base = 'flex w-full items-center gap-3 rounded-[12px] bg-white px-2.5 py-2 text-left';
            return (
              <li key={part.id} data-fixed-part={part.key} className="min-w-0">
                {interactive && part.from !== null ? (
                  <button
                    type="button"
                    data-fixed-item={part.id}
                    aria-pressed={pressed}
                    onClick={() => onSelect?.(part)}
                    className={`${base} min-h-11 transition-[box-shadow,background-color] duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CC1573] ${
                      pressed ? 'ring-[1.5px] ring-[#09090B]' : 'hover:ring-1 hover:ring-[#09090B]/15'
                    }`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={base}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
