'use client';
import { useState } from 'react';

/** One step's disclosed prompt to the clipboard. The text is already on the page; this only copies it. */
export function CopyPrompt({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" data-recipe-copy onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => undefined); }}
    className="inline-flex min-h-9 items-center rounded-full border border-hairline px-3 text-xs" aria-live="polite">{copied ? done : label}</button>;
}
