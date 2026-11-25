'use client';

import { ClipCard, type ClipCardLabels } from '@/components/recipes/clip-card';
import { usePostAccess } from './post-access-context';

export interface PostPromptCardLabels {
  gateTitle: string;
  gateCta: string;
  card: ClipCardLabels;
}

/**
 * Renders a blog prompt block:
 *   - Signed-out: numbered title + sign-in CTA ONLY (no condition line, no prompt text, no tip).
 *   - Signed-in: full `ClipCard` once `/api/posts/access` resolves.
 */
export function PostPromptCard({
  promptIndex,
  promptNumber,
  title,
  signinHref,
  labels,
}: {
  promptIndex: number;
  promptNumber: number;
  title: string;
  signinHref: string;
  labels: PostPromptCardLabels;
}) {
  const access = usePostAccess();
  const unlocked = access?.prompts?.[promptIndex] ?? null;

  if (unlocked) {
    return (
      <ClipCard
        as="article"
        number={promptNumber}
        title={unlocked.title}
        meta={unlocked.meta ?? null}
        note={unlocked.note ?? null}
        noteMarker="guide"
        prompt={unlocked.prompt}
        labels={labels.card}
        itemAttr={{ 'data-recipe-guide-step': promptNumber }}
      />
    );
  }

  return (
    <div
      data-maker-blog-prompt-locked={promptNumber}
      className="rounded-[16px] border border-[#09090B]/[0.08] bg-white p-5"
    >
      <div className="flex items-baseline gap-2.5">
        <span
          data-clip-number
          className="inline-flex shrink-0 items-center rounded-full bg-[#F4F4F5] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#09090B]"
        >
          {String(promptNumber).padStart(2, '0')}
        </span>
        <h3 className="min-w-0 break-keep text-[15px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#09090B] sm:text-base">
          {title}
        </h3>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F4F4F5] px-4 py-3">
        <p className="break-keep text-xs font-medium text-[#52525B]">{labels.gateTitle}</p>
        <a
          data-maker-blog-prompt-gate-cta
          href={signinHref}
          className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-white px-4 text-xs font-semibold text-[#09090B] ring-1 ring-[#09090B]/[0.12] transition-colors hover:bg-[#E4E4E7]"
        >
          {labels.gateCta}
        </a>
      </div>
    </div>
  );
}
