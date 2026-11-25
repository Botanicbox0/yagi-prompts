'use client';

import { useState } from 'react';
import { parseInstagramPost } from '@/lib/posts/schema';

export interface InstagramEmbedLabels {
  placeholderLabel: string;
  showEmbed: string;
  openExternal: string;
  fallback: string;
}

/**
 * Privacy-first Instagram facade:
 *   - Before click: zero requests to instagram.com (no iframe, no script, no remote image), no account
 *     handle shown, clean solid placeholder + "인스타그램에서 보기" button.
 *   - After click: mounts the official /p/<id>/embed or /reel/<id>/embed iframe with `loading="lazy"`,
 *     `referrerPolicy="no-referrer"`, and minimal `sandbox`.
 *   - Always renders an external link below with `rel="noopener noreferrer nofollow ugc"`.
 */
export function InstagramEmbed({
  url,
  labels,
}: {
  url: string;
  labels: InstagramEmbedLabels;
}) {
  const [loaded, setLoaded] = useState(false);
  const parsed = parseInstagramPost(url);
  if (!parsed) return null;

  return (
    <div
      data-maker-blog-instagram={loaded ? 'loaded' : 'idle'}
      className="overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-white"
    >
      {!loaded ? (
        <div className="flex flex-col items-start justify-between gap-4 bg-[#F4F4F5] p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#09090B] ring-1 ring-[#09090B]/[0.08]"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <p className="break-keep text-sm font-semibold text-[#09090B]">{labels.placeholderLabel}</p>
          </div>
          <button
            type="button"
            data-instagram-load
            onClick={() => setLoaded(true)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-[#09090B] px-5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
          >
            {labels.showEmbed}
          </button>
        </div>
      ) : (
        <div className="bg-[#F4F4F5]">
          <iframe
            data-instagram-iframe
            src={parsed.embedUrl}
            title={labels.placeholderLabel}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="h-[30rem] w-full border-0 bg-white sm:h-[34rem]"
          />
          <p className="border-t border-[#09090B]/[0.08] px-4 py-2 text-xs text-[#71717A]">
            {labels.fallback}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end border-t border-[#09090B]/[0.08] bg-white px-4 py-2.5 sm:px-5">
        <a
          data-instagram-external
          href={parsed.url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="inline-flex min-h-9 items-center text-xs font-medium text-[#52525B] underline decoration-[#09090B]/25 underline-offset-4 transition-colors hover:text-[#09090B] hover:decoration-[#09090B]"
        >
          {labels.openExternal} ↗
        </a>
      </div>
    </div>
  );
}
