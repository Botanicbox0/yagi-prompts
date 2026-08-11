'use client';

import { useState } from 'react';

/**
 * §3.3 — "prompt: monospace block, copy button (Pro)".
 *
 * It is only rendered for a viewer who is already reading the prompt, so the text it copies is text
 * that is already in their HTML: no gate lives here, and none could. The gate is the server's
 * decision to render an unlocked block at all (lib/content/playbook-access.ts).
 */
export function CopyButton({
  value,
  labels,
}: {
  value: string;
  labels: { copy: string; copied: string; failed: string };
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // Insecure context or a browser without the API — say so rather than lying with a tick.
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      data-state={state}
      className="border border-hairline px-3 py-1.5 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
    >
      {state === 'copied' ? labels.copied : state === 'failed' ? labels.failed : labels.copy}
    </button>
  );
}
