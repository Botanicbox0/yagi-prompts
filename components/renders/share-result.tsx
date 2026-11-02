'use client';

import { useState } from 'react';

/**
 * The result page's "공유": the existing 3-day link (`/r/{id}/{token}`), handed to the system share
 * sheet where there is one (phones), copied to the clipboard where there is not. If neither works
 * the link is shown as selectable text, so sharing never dead-ends.
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

interface ShareNavigator {
  share?: (data: { title: string; url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

export async function shareOrCopy(nav: ShareNavigator, url: string, title: string): Promise<ShareOutcome> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error) {
      // Closing the sheet is a choice, not a failure.
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}

export function ShareResult({
  url,
  title,
  className,
  labels,
}: {
  url: string;
  title: string;
  className: string;
  labels: { share: string; copied: string; failed: string };
}) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  return (
    <>
      <button
        type="button"
        data-result-action="share"
        onClick={async () => setOutcome(await shareOrCopy(navigator as ShareNavigator, url, title))}
        className={className}
      >
        {labels.share}
      </button>
      <p role="status" aria-live="polite" className="col-span-3 basis-full text-sm empty:hidden">
        {outcome === 'copied' ? labels.copied : outcome === 'failed' ? labels.failed : ''}
      </p>
      {outcome === 'failed' && (
        <p data-share-link className="col-span-3 basis-full border border-hairline p-3 font-mono text-[0.78rem] break-all select-all">{url}</p>
      )}
    </>
  );
}
