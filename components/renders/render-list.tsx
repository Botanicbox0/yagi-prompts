import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { formatDate } from '@/lib/i18n/format';
import type { RenderView } from '@/lib/renders/service';
import { renderHref } from '@/lib/renders/share';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * One row per render — the owner's list on `/renders` and the last few on `/account`. A row is
 * its status, the template, the date, and the way in; nothing about how it was made.
 */
export function RenderList({ items, locale, dict }: { items: RenderView[]; locale: Locale; dict: Dictionary }) {
  const r = dict.renders;
  return (
    <ul data-render-list className="flex flex-col divide-y divide-hairline border-y border-hairline">
      {items.map(({ job, templateTitle, templateTitleKo }) => {
        const title = locale === 'ko' && templateTitleKo ? templateTitleKo : templateTitle;
        return (
          <li key={job.id} data-render-row={job.id} data-status={job.status} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <a href={renderHref(job.id)} className="font-display text-[1.15rem] leading-none font-black uppercase">
                {title}
              </a>
              <p className="mt-1.5 font-mono text-[0.75rem] opacity-60">
                {dict.nav[job.medium]} · {job.aspect} · {formatDate(job.createdAt, locale) ?? ''}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span data-render-status={job.status} className={`border px-2 py-1 font-label text-[0.7rem] tracking-[0.12em] uppercase ${job.status === 'succeeded' ? 'border-accent text-accent' : job.status === 'failed' ? 'border-current opacity-60' : 'border-hairline'}`}>
                {r.status[job.status]}
              </span>
              <a href={renderHref(job.id)} className="font-label text-eyebrow uppercase">
                <TextSwap>{r.open} →</TextSwap>
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
