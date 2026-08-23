'use client';

import { useState } from 'react';
import { promptCopyPath } from '@/lib/prompts/links';

/**
 * "Make this on Higgsfield" — the handoff (founder direction, 2026-08-15).
 *
 * The founder asked whether the site could run generations itself. It can, and at Seedance 2.5's
 * per-second pricing one 10-second clip costs more than a whole $4 cookie pack — so the honest
 * first move is not to sell compute at a loss but to hand the prompt to the tool that already has
 * the reader's account. Zero cost, zero moderation surface, and the funnel stays intact.
 *
 * Two things happen on one press, in this order and for a reason:
 *   1. the tab opens SYNCHRONOUSLY, inside the click, or a popup blocker eats it — no `await` may
 *      come first;
 *   2. the prompt is fetched through `/api/prompts/copy/[id]` (the SAME entitlement-checked route
 *      the copy button uses, so this adds no second gate) and written to the clipboard.
 *
 * Higgsfield publishes no documented URL parameter that prefills a prompt, so this deliberately
 * does not invent one: a made-up query string would look like it worked and silently drop the text.
 * Clipboard + paste is the contract that holds until they publish one — and if they ever do, only
 * `HIGGSFIELD_CREATE_URL` changes.
 */

export const HIGGSFIELD_CREATE_URL = 'https://higgsfield.ai/create';

export interface RunLabels {
  run: string;
  copied: string;
  failed: string;
}

export function PromptRunButton({
  id,
  labels,
  className,
}: {
  id: string;
  labels: RunLabels;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onRun = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // FIRST, inside the user gesture: the tab. `noopener,noreferrer` because this is an outbound
    // link to a third party — it gets neither our window handle nor our referrer.
    window.open(HIGGSFIELD_CREATE_URL, '_blank', 'noopener,noreferrer');

    try {
      const response = await fetch(promptCopyPath(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = response.ok ? ((await response.json()) as { text?: unknown }) : null;
      if (typeof body?.text !== 'string') throw new Error('no text');
      await navigator.clipboard.writeText(body.text);
      setState('copied');
    } catch {
      // The tab is already open, so the reader is not stuck — they just have to copy by hand.
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2400);
  };

  return (
    <button
      type="button"
      onClick={onRun}
      data-run-prompt={id}
      data-state={state}
      className={
        className ??
        'relative z-10 border border-current px-4 py-2 font-label text-eyebrow uppercase transition-opacity hover:opacity-70'
      }
    >
      {state === 'copied' ? labels.copied : state === 'failed' ? labels.failed : labels.run}
    </button>
  );
}
