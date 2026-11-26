import { parseInstagramPost } from '@/lib/posts/schema';

export interface InstagramLinkLabels {
  placeholderLabel: string;
  open: string;
}

/**
 * Link-only Instagram card for the template page ("원본 게시물"): links out to the
 * canonical post URL instead of embedding, so the page makes no request to Instagram.
 */
export function InstagramLink({
  url,
  labels,
}: {
  url: string;
  labels: InstagramLinkLabels;
}) {
  const parsed = parseInstagramPost(url);
  if (!parsed) return null;

  return (
    <div
      data-instagram-link
      className="overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-white"
    >
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
        <a
          data-instagram-external
          href={parsed.url}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-[#09090B] px-5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
        >
          {labels.open} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
