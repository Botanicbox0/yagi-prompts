'use client';

import { useEffect, useId, useLayoutEffect, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import { applyRailVisibility, type FilterRail } from '@/components/prompts/filter-chips';
import { TEMPLATE_LOOKS, type TemplateLook } from '@/lib/template-look/look';
import { lookQuestionSnoozed, recordChosenLook, revealAllLooks, shouldAskLook, snoozeLookQuestion } from '@/lib/template-look/store';
import { useLookState, useViewerLook } from './use-viewer-look';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the template style on the static template pages. Rendered ONLY with
 * `TWINGS_TEMPLATE_LOOK=on` (the pages decide on the server); the server markup is empty either way, so the cached HTML
 * is the same for everyone and a crawler sees every template.
 *
 *   · `LookScope` hides the other style's cards on every rail the page does not hand to a chip filter (cast shelves,
 *     a maker's rail, the related templates) through the one visibility pass the chip filter uses;
 *   · `LookQuestion` asks a signed-in person with no choice yet, once, skippable, at most once a day;
 *   · a click on any rail's "다른 스타일도 보기" shows every card for this page view.
 */
export type TemplateLookCopy = Dictionary['templateLook'];

export const TEMPLATE_LOOK_ENDPOINT = '/api/account/template-look';

/** Store (or clear) the choice through the one route; true when it was stored (and the cookie set with it). */
export async function postTemplateLook(look: TemplateLook | null, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<boolean> {
  try {
    const response = await fetchImpl(TEMPLATE_LOOK_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ look }),
    });
    if (!response.ok) return false;
    recordChosenLook(look);
    return true;
  } catch {
    return false;
  }
}

const RELATED_ITEM = '[data-related-item]';

function currentPath(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname;
}

/** Every rail and related grid on the page except the ones a chip filter owns (it runs the same pass itself). */
export function LookScope({ exclude = [] }: { exclude?: string[] }) {
  const viewer = useViewerLook(true);
  const look = viewer?.look ?? null;
  const showAll = viewer?.showAll ?? false;
  const excludeKey = exclude.join(' ');

  useLayoutEffect(() => {
    const skip = new Set(excludeKey.split(' ').filter(Boolean));
    const state = { look, showAll };
    // Template rails only (a campaign rail shares `data-rail` but holds no template card).
    const rails = [...document.querySelectorAll<HTMLElement>('[data-rail]')].filter((rail) => !skip.has(rail.dataset.rail ?? '') && rail.querySelector('[data-prompt-item]') !== null);
    for (const rail of rails) applyRailVisibility(rail as unknown as FilterRail, {}, state);
    // The related templates: no "nothing here" line of their own, so a section the style empties steps out whole.
    const grids = [...document.querySelectorAll<HTMLElement>('[data-related-grid]')];
    for (const grid of grids) {
      const result = applyRailVisibility(grid as unknown as FilterRail, {}, state, RELATED_ITEM);
      const section = grid.closest('section');
      if (section) section.hidden = result.visible === 0 && result.lookHidden > 0;
    }
    return () => {
      for (const rail of rails) applyRailVisibility(rail as unknown as FilterRail, {}, null);
      for (const grid of grids) {
        applyRailVisibility(grid as unknown as FilterRail, {}, null, RELATED_ITEM);
        const section = grid.closest('section');
        if (section) section.hidden = false;
      }
    };
  }, [look, showAll, excludeKey]);

  return null;
}

/** One delegated listener for every rail's "다른 스타일도 보기" (the rails are server markup). */
function RevealListener() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-look-reveal]') : null;
      if (target) revealAllLooks(currentPath());
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}

/** The two large options, the women's style first, and the one line under them. */
export function LookChoice({ copy, chosen, busy, onChoose, lineId }: {
  copy: TemplateLookCopy;
  chosen: TemplateLook | null;
  busy: boolean;
  onChoose: (look: TemplateLook) => void;
  lineId: string;
}) {
  return (
    <div data-look-choice role="group" aria-labelledby={lineId}>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATE_LOOKS.map((look) => (
          <button
            key={look}
            type="button"
            data-look-option={look}
            aria-pressed={chosen === look}
            disabled={busy}
            onClick={() => onChoose(look)}
            className={[
              'flex min-h-12 items-center justify-center rounded-full px-4 text-[0.95rem] font-semibold',
              'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-editorial)] motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF58AE] disabled:opacity-60',
              chosen === look ? 'bg-[#09090B] text-white' : 'bg-[#F4F4F5] text-[#09090B] hover:bg-[#E4E4E7]',
            ].join(' ')}
          >
            {copy[look]}
          </button>
        ))}
      </div>
      <p id={lineId} className="mt-3 text-[0.875rem] leading-relaxed text-[#52525B] break-keep">{copy.question}</p>
    </div>
  );
}

/**
 * The question, as a small card at the bottom of the screen that never blocks the page: a signed-in person whose choice
 * is unset, and only when the after-signup sheet is not asking it. "나중에" leaves it unset (everything stays visible)
 * and it may ask again a day later.
 */
export function LookQuestion({ copy, now = Date.now }: { copy: TemplateLookCopy; now?: () => number }) {
  const state = useLookState(true);
  const [snoozed, setSnoozed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [entered, setEntered] = useState(false);
  const lineId = useId();
  useEffect(() => setSnoozed(lookQuestionSnoozed(now())), [now]);

  const open = !closed && shouldAskLook(state, snoozed);
  useEffect(() => {
    if (!open) { setEntered(false); return; }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!open) return null;

  const later = () => {
    snoozeLookQuestion(now());
    setClosed(true);
  };
  const choose = async (look: TemplateLook) => {
    setBusy(true);
    const stored = await postTemplateLook(look);
    setBusy(false);
    // Stored: the store now knows the choice and the card goes by itself. Not stored (0190 missing, offline): leave
    // it unset and ask again another day rather than keep a card on screen that cannot save.
    if (!stored) later();
  };

  return (
    <aside
      data-look-question
      data-hide-tabs
      aria-labelledby={lineId}
      className={[
        'fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 rounded-[16px] border border-[#09090B]/[0.08] bg-white p-4 text-[#09090B]',
        'shadow-[0_12px_32px_rgba(9,9,11,0.12)] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[23rem] sm:p-5',
        'transition-[translate,opacity] duration-[var(--duration-base)] ease-[var(--ease-editorial)] motion-reduce:transition-none',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      ].join(' ')}
    >
      <LookChoice copy={copy} chosen={null} busy={busy} onChoose={(look) => void choose(look)} lineId={lineId} />
      <div className="mt-1 flex justify-end">
        <button type="button" data-look-later onClick={later} className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm text-[#52525B] underline underline-offset-4 hover:text-[#09090B]">
          {copy.later}
        </button>
      </div>
    </aside>
  );
}

/**
 * The page's style island. `scope` null: another island owns every card on the page (the home curation does), so this
 * only asks the question and listens for "다른 스타일도 보기".
 */
export function TemplateLookIsland({ copy, scope = {} }: { copy: TemplateLookCopy; scope?: { exclude?: string[] } | null }) {
  return (
    <>
      {scope && <LookScope {...(scope.exclude ? { exclude: scope.exclude } : {})} />}
      <RevealListener />
      <LookQuestion copy={copy} />
    </>
  );
}
