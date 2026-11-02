'use client';

import { useState } from 'react';

/**
 * docs/PLATFORM-2.0.md §20 — the two interactive bits of a creative's identity. The public email is
 * not in the page's HTML as text or as a `mailto:` (a scraper reads both); it arrives reversed and
 * is put together only when a person asks for it.
 */
export function RevealEmail({ reversed, labels }: { reversed: string; labels: { show: string; copy: string; copied: string } }) {
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!email) {
    return (
      <button
        type="button"
        data-creative-email="hidden"
        onClick={() => setEmail([...reversed].reverse().join(''))}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-black px-5 text-sm font-medium text-white transition-opacity hover:opacity-85"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6 8.5 7 8.5-7" /></svg>
        {labels.show}
      </button>
    );
  }
  return (
    <span data-creative-email="shown" className="inline-flex min-h-11 flex-wrap items-center gap-2 rounded-full border border-black/80 pr-1.5 pl-4 text-sm">
      <a href={`mailto:${email}`} className="font-medium break-all underline-offset-4 hover:underline">{email}</a>
      <button
        type="button"
        onClick={async () => { try { await navigator.clipboard.writeText(email); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the address is on screen anyway */ } }}
        className="inline-flex min-h-8 items-center rounded-full bg-black px-3 text-xs font-medium text-white"
      >
        {copied ? labels.copied : labels.copy}
      </button>
    </span>
  );
}

/** Copies the short profile link (`twings.app/@handle`), or opens the share sheet where there is one. */
export function ShareProfile({ url, title, labels }: { url: string; title: string; labels: { share: string; shared: string } }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-creative-share
      onClick={async () => {
        try {
          if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) await navigator.share({ url, title });
          else { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1800); }
        } catch { /* dismissed */ }
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline bg-surface px-4 text-sm text-black/80 transition-colors hover:border-black/40 hover:text-black"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
      <span aria-live="polite">{done ? labels.shared : labels.share}</span>
    </button>
  );
}
