'use client';

import { useState } from 'react';
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionaries';

export type OpenMakerCopy = Dictionary['creatorProgram']['openMaker'];

export interface OpenMakerCardProps {
  locale: 'ko' | 'en';
  workspaceHref?: string;
  copy?: OpenMakerCopy;
}

export function OpenMakerCard({
  locale,
  workspaceHref = '/creators/workspace',
  copy,
}: OpenMakerCardProps) {
  const c = copy ?? getDictionary(locale).creatorProgram.openMaker;
  const [rightsAgreed, setRightsAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    if (!rightsAgreed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/makers/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rightsAgreed: true }),
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (!response.ok || !json.ok) {
        setError(c.errorActivate);
        return;
      }
      window.location.assign(`${workspaceHref}?ok=applied`);
    } catch {
      setError(c.errorNetwork);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-open-maker-activate
      className="space-y-5 rounded-[20px] border border-[#E4E4E7] bg-[#FFFFFF] p-6"
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wider text-[#CC1573]">
          {c.eyebrow}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-[#09090B]">
          {c.heading}
        </h2>
        <p className="text-sm leading-relaxed text-[#52525B]" style={{ wordBreak: 'keep-all' }}>
          {c.body}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E4E4E7] bg-[#F4F4F5] p-4 text-sm leading-relaxed text-[#09090B]">
        <input
          type="checkbox"
          data-open-maker-pledge
          checked={rightsAgreed}
          onChange={(e) => setRightsAgreed(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#09090B]"
        />
        <span style={{ wordBreak: 'keep-all' }}>{c.pledge}</span>
      </label>

      {error ? (
        <p role="alert" className="text-sm font-medium text-[#CC1573]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-open-maker-submit
          disabled={!rightsAgreed || busy}
          onClick={() => void activate()}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-[#FF58AE] px-6 py-3 text-sm font-bold text-[#09090B] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? c.submitting : c.submit}
        </button>
      </div>
    </section>
  );
}
