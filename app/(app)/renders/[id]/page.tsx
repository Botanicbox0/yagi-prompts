import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { absoluteUrl } from '@/lib/seo/site-url';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { templateHref } from '@/lib/prompts/links';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { failureReason, loadOwnRender } from '@/lib/renders/service';
import { RENDERS_PATH, renderMediaHref, shareHref } from '@/lib/renders/share';
import { AppHeader } from '@/components/app/app-header';
import { AutoRefresh } from '@/components/renders/auto-refresh';
import { ResultMedia } from '@/components/renders/result-media';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * `/renders/[id]` — the owner's result page. Queued or running: a calm wait that refreshes
 * itself and nudges the queue (a film waiting on the provider is polled here, so a reader who
 * keeps the page open sees it finish without any cron). Finished: the object, a download, the
 * template to make another. Failed: why, in their language, and the way back.
 */
export const dynamic = 'force-dynamic';

/** A job still queued this long after it was created was not picked up by the enqueue request. */
const STRANDED_AFTER_MS = 45_000;

export default async function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, viewer, sql] = await Promise.all([getLocaleFromHeaders(), getViewer(), getSqlRunner()]);
  const dict = getDictionary(locale);
  const r = dict.renders;
  if (sql === null) notFound();

  const view = await loadOwnRender(sql, viewer, id);
  if (view === null) notFound();
  const { job } = view;
  const title = locale === 'ko' && view.templateTitleKo ? view.templateTitleKo : view.templateTitle;
  const pending = job.status === 'queued' || job.status === 'running';

  if (pending) {
    // The page is the tick when nothing else is: a film waiting on the provider gets polled, and
    // a job the enqueue request never ran (a cold start that died) gets claimed — after the
    // response, so the reader is never made to wait on it.
    const stranded = job.status === 'queued' && Date.now() - Date.parse(job.createdAt) > STRANDED_AFTER_MS;
    after(async () => {
      try {
        await runLiveRenderPass(sql, stranded ? { jobId: job.id, limit: 1 } : { limit: 0 });
      } catch (error) {
        console.error(`[renders] page pass failed for ${job.id}`, error);
      }
    });
  }

  const mediaSrc = renderMediaHref(job.id);
  const downloadSrc = renderMediaHref(job.id, { download: true });
  const templateUrl = templateHref(locale, job.templateSlug);

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={`${RENDERS_PATH}/${job.id}`} />
      {pending && <AutoRefresh />}

      <main id="main" data-render={job.id} data-status={job.status} className="band py-16 lg:py-20">
        <a href={RENDERS_PATH} className="font-mono text-[0.72rem] opacity-60">
          ← {r.title}
        </a>
        <p className="text-accent mt-6 font-label text-eyebrow uppercase">{r.detailEyebrow}</p>
        <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.4rem)] leading-[0.95] font-black uppercase">{title}</h1>
        <p className="mt-4 font-mono text-[0.78rem] opacity-60">
          {dict.nav[job.medium]} · {job.aspect} · {formatDate(job.createdAt, locale) ?? ''}
        </p>

        {pending && (
          <section data-render-waiting className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{r.waitingTitle}</p>
            <div className="mt-6 h-1 w-full max-w-md overflow-hidden bg-hairline" role="progressbar" aria-busy="true">
              <div className="h-full w-1/3 animate-pulse bg-accent" />
            </div>
            <p className="mt-6 text-body opacity-70">{r.waitingBody}</p>
            <p className="mt-3 font-mono text-[0.75rem] opacity-45">{r.status[job.status]}</p>
          </section>
        )}

        {job.status === 'succeeded' && job.resultMime && (
          <section data-render-result className="mt-10">
            <div className="max-w-[40rem] border border-hairline">
              <ResultMedia src={mediaSrc} mime={job.resultMime} aspect={job.aspect} />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href={downloadSrc} data-render-download className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
                <TextSwap>{r.download} ↓</TextSwap>
              </a>
              <a href={`${templateUrl}#make`} className="text-accent font-label text-eyebrow uppercase">
                <TextSwap>{r.makeAgain} →</TextSwap>
              </a>
            </div>
            {job.shareToken && job.shareExpiresAt && (
              <div className="mt-8 max-w-detail">
                <p className="font-label text-eyebrow uppercase opacity-60">{r.shareLinkLabel}</p>
                {/* `select-all`: one press selects the whole address — the copy this field exists for. */}
                <p data-share-link className="mt-2 border border-hairline p-3 font-mono text-[0.78rem] break-all select-all">
                  {absoluteUrl(shareHref(job.id, job.shareToken))}
                </p>
                <p className="mt-3 font-mono text-[0.75rem] opacity-45">
                  {interpolate(r.shareNote, { date: formatDate(job.shareExpiresAt, locale) ?? '' })}
                </p>
              </div>
            )}
          </section>
        )}

        {job.status === 'failed' && (
          <section data-render-failed className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{r.failedTitle}</p>
            <p className="mt-5 text-body opacity-70">{failureReason(job.errorCode, locale)}</p>
            <p className="mt-2 font-mono text-[0.75rem] opacity-45">{r.notCharged}</p>
            <a href={`${templateUrl}#make`} className="mt-8 inline-block border border-current px-6 py-3 font-label text-label uppercase">
              <TextSwap>{r.makeAgain} →</TextSwap>
            </a>
          </section>
        )}
      </main>
    </div>
  );
}
