'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAppErrorCopy } from '@/components/app/error-copy';
import { STATIC_ERROR_COPY } from '@/components/app/static-error-copy';

/**
 * The `(app)` group's error boundary (audit P1-3): a failure on a result page, a payment page or
 * the account page used to collapse to `global-error`. The copy comes from the dictionary through
 * the layout's provider (see components/app/error-copy.tsx), never from a client-side dictionary.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const provided = useAppErrorCopy();
  const copy = provided ?? { ...STATIC_ERROR_COPY.ko, locale: 'ko', home: null, homeHref: null };

  return (
    <main id="main" data-app-error lang={copy.locale} data-section data-theme="light" className="section min-h-screen">
      <div role="alert" className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
        <h1 className="max-w-detail font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-[0.92] font-black uppercase">
          {copy.title}
        </h1>
        <p className="mt-6 max-w-detail text-body opacity-70">{copy.body}</p>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
          <button
            type="button"
            data-app-error-retry
            className="inline-block bg-accent px-5 py-3 font-label text-label text-white uppercase"
            onClick={() =>
              // In Next 15 `reset` only re-renders the payload the boundary already has; a failure
              // thrown while rendering on the server needs a fresh server render first.
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            {copy.retry}
          </button>
          {copy.home && copy.homeHref && (
            <a href={copy.homeHref} className="inline-block border border-current px-5 py-3 font-label text-label uppercase">
              {copy.home} →
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
