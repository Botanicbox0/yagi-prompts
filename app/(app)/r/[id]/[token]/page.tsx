import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TwingsMark } from '@/components/brand/twings-mark';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { templateHref } from '@/lib/prompts/links';
import { loadSharedRender } from '@/lib/renders/service';
import { renderHref, renderMediaHref } from '@/lib/renders/share';
import { ResultMedia } from '@/components/renders/result-media';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * `/r/[id]/[token]` — the 3-day link from the completion message (docs/TEMPLATES-IA.md §8).
 *
 * No session, no locale prefix, no middleware (excluded like `/auth/*`): the token IS the
 * capability, and the page speaks the language the render was ordered in. It shows the object,
 * offers the download, and points at the template for the next one. Expired: it says so and
 * sends the owner to sign in — the render is still theirs on `/renders/{id}`.
 */
export const dynamic = 'force-dynamic';

interface RouteProps {
  params: Promise<{ id: string; token: string }>;
}

async function resolve(props: RouteProps) {
  const { id, token } = await props.params;
  const sql = await getSqlRunner();
  if (sql === null) return null;
  const shared = await loadSharedRender(sql, id, token);
  if (shared.status === 'not_found') return null;
  return { ...shared, dict: getDictionary(shared.view.job.locale), id, token };
}

export async function generateMetadata(props: RouteProps): Promise<Metadata> {
  const resolved = await resolve(props);
  if (resolved === null) return { robots: { index: false, follow: false } };
  return { title: resolved.dict.renders.readyTitle, robots: { index: false, follow: false } };
}

export default async function SharedRenderPage(props: RouteProps) {
  const resolved = await resolve(props);
  if (resolved === null) notFound();
  const { dict, view, id, token } = resolved;
  const r = dict.renders;
  const { job } = view;
  const locale = job.locale;
  const title = locale === 'ko' && view.templateTitleKo ? view.templateTitleKo : view.templateTitle;
  const templateUrl = templateHref(locale, job.templateSlug);

  return (
    <main data-shared-render={job.id} data-share-status={resolved.status} className="mx-auto min-h-svh w-full max-w-shell px-gutter py-10">
      <a href={`/${locale}`} className="inline-flex items-center gap-2.5">
        <TwingsMark className="h-7" />
        <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">{dict.meta.siteName}</span>
      </a>

      {resolved.status === 'expired' ? (
        <section data-share-expired className="mt-16 max-w-detail">
          <p className="text-accent font-label text-eyebrow uppercase">{r.detailEyebrow}</p>
          <h1 className="mt-4 font-display text-[clamp(1.8rem,4vw,3rem)] leading-[0.95] font-black uppercase">{r.expiredTitle}</h1>
          <p className="mt-5 text-body opacity-70">{r.expiredBody}</p>
          <a href={signInHref(renderHref(id), locale)} className="mt-8 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
            <TextSwap>{r.signInToView} →</TextSwap>
          </a>
        </section>
      ) : (
        <section className="mt-12">
          <p className="text-accent font-label text-eyebrow uppercase">{r.detailEyebrow}</p>
          <h1 className="mt-4 font-display text-[clamp(1.8rem,4vw,3rem)] leading-[0.95] font-black uppercase">{title}</h1>
          <p className="mt-4 font-mono text-[0.78rem] opacity-60">
            {dict.nav[job.medium]} · {job.aspect} · {formatDate(job.finishedAt ?? job.createdAt, locale) ?? ''}
          </p>

          <div className="mt-8 max-w-[40rem] border border-hairline">
            {job.resultMime && <ResultMedia src={renderMediaHref(job.id, { share: token })} mime={job.resultMime} aspect={job.aspect} />}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={renderMediaHref(job.id, { share: token, download: true })} data-render-download className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
              <TextSwap>{r.download} ↓</TextSwap>
            </a>
            <a href={`${templateUrl}#make`} className="text-accent font-label text-eyebrow uppercase">
              <TextSwap>{r.makeYours} →</TextSwap>
            </a>
          </div>
          {job.shareExpiresAt && (
            <p className="mt-6 max-w-detail font-mono text-[0.75rem] opacity-45">
              {interpolate(r.shareNote, { date: formatDate(job.shareExpiresAt, locale) ?? '' })}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
