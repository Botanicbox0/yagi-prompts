'use client';

import { useState } from 'react';
import { promptCopyPath } from '@/lib/prompts/links';

/**
 * PLAN §13.2 — the copy button, on the card AND on the detail page, always through
 * `/api/prompts/copy/[id]`.
 *
 * This is the piece that lets a **static** gallery offer copy at all: the card carries no prompt
 * text (by construction — see `lib/prompts/catalog.ts`), so the only way to hand a reader the text
 * is to ask the server for it with their own session attached. The gate therefore lives in exactly
 * one place for every tier and every surface, and the cached HTML is identical for everyone.
 *
 * The three answers, and what each one MEANS to the reader:
 *   200 → the text, straight to the clipboard
 *   401 → nobody is signed in; start Journey A and come back
 *   403 → signed in, not entitled; this is the upgrade moment
 * A refusal is never a dead click and never a silent one.
 */

export interface CopyLabels {
  copy: string;
  copied: string;
  failed: string;
  locked: string;
}

export function PromptCopyButton({
  id,
  labels,
  signinHref,
  upgradeHref,
  className,
}: {
  id: string;
  labels: CopyLabels;
  signinHref: string;
  upgradeHref: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'failed' | 'locked'>('idle');

  const onCopy = async (event: React.MouseEvent) => {
    // The card is a stretched-link block; this button must not follow it.
    event.preventDefault();
    event.stopPropagation();
    if (state === 'busy') return;
    setState('busy');

    try {
      const response = await fetch(promptCopyPath(id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      if (response.status === 401) {
        window.location.href = signinHref;
        return;
      }
      if (response.status === 403) {
        setState('locked');
        window.location.href = upgradeHref;
        return;
      }
      if (!response.ok) {
        setState('failed');
        window.setTimeout(() => setState('idle'), 2000);
        return;
      }

      const body = (await response.json()) as { text?: unknown };
      if (typeof body.text !== 'string') {
        setState('failed');
      } else {
        await navigator.clipboard.writeText(body.text);
        setState('copied');
      }
    } catch {
      // Insecure context, blocked clipboard, offline — say so rather than lying with a tick.
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2000);
  };

  const text =
    state === 'copied'
      ? labels.copied
      : state === 'failed'
        ? labels.failed
        : state === 'locked'
          ? labels.locked
          : labels.copy;

  return (
    <button
      type="button"
      onClick={onCopy}
      data-copy-prompt={id}
      data-state={state}
      className={
        className ??
        'relative z-10 border border-hairline px-3 py-1.5 font-label text-[0.65rem] tracking-[0.12em] uppercase transition-opacity hover:opacity-70'
      }
    >
      {text}
    </button>
  );
}
