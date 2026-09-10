import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { absoluteUrl } from '@/lib/seo/site-url';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { templateHref } from '@/lib/prompts/links';
import { identityVerifyHref } from '@/lib/identity/links';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { failureReason, loadOwnRender } from '@/lib/renders/service';
import { FEEDBACK_REASONS, loadRenderFeedback } from '@/lib/renders/feedback';
import { ASSET_TASK_PREFIX } from '@/lib/renders/repo';
import { submitFeedbackAction } from './actions';
import { RENDERS_PATH, renderHref, renderMediaHref, shareHref } from '@/lib/renders/share';
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

export default async function RenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const [locale, viewer, sql] = await Promise.all([getLocaleFromHeaders(), getViewer(), getSqlRunner()]);
  const dict = getDictionary(locale);
  const r = dict.renders;
  if (sql === null) notFound();

  const view = await loadOwnRender(sql, viewer, id);
  if (view === null) notFound();
  const { job } = view;
  const title = locale === 'ko' && view.templateTitleKo ? view.templateTitleKo : view.templateTitle;
  const held = job.status === 'held';
  const pending = job.status === 'queued' || job.status === 'running';
  const finished = job.status === 'succeeded' || job.status === 'failed';
  // "Not happy with the result?" — what they said before, and whether they just said it.
  const feedback = finished ? await loadRenderFeedback(sql, job.id) : null;
  const feedbackOutcome = typeof query.feedback === 'string' ? query.feedback : null;
  const matching = job.status === 'running' && job.providerTaskId !== null && job.providerTaskId.startsWith(ASSET_TASK_PREFIX);

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
      {(pending || held) && <AutoRefresh />}

      <main id="main" data-render={job.id} data-status={job.status} className="band py-16 lg:py-20">
        <a href={RENDERS_PATH} className="font-mono text-[0.72rem] opacity-60">
          ← {r.title}
        </a>
        <p className="text-accent mt-6 font-label text-eyebrow uppercase">{r.detailEyebrow}</p>
        <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.4rem)] leading-[0.95] font-black uppercase">{title}</h1>
        <p className="mt-4 font-mono text-[0.78rem] opacity-60">
          {dict.nav[job.medium]} · {job.aspect} · {formatDate(job.createdAt, locale) ?? ''}
        </p>

        {held && (
          <section data-render-held className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{r.heldTitle}</p>
            <p className="mt-5 text-body opacity-70">{r.heldBody}</p>
            <a href={identityVerifyHref(renderHref(job.id))} data-identity-door className="mt-8 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
              <TextSwap>{dict.identity.start} →</TextSwap>
            </a>
          </section>
        )}

        {pending && (
          <section data-render-waiting className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{r.waitingTitle}</p>
            <div className="mt-6 h-1 w-full max-w-md overflow-hidden bg-hairline" role="progressbar" aria-busy="true">
              <div className="h-full w-1/3 animate-pulse bg-accent" />
            </div>
            <p className="mt-6 text-body opacity-70">{matching ? r.stageMatching : r.waitingBody}</p>
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
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              {(job.errorCode === 'identity_required' || job.errorCode === 'face_policy') && (
                <a href={identityVerifyHref(`${templateUrl}#make`)} data-identity-door className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
                  <TextSwap>{dict.identity.start} →</TextSwap>
                </a>
              )}
              <a href={`${templateUrl}#make`} className="inline-block border border-current px-6 py-3 font-label text-label uppercase">
                <TextSwap>{r.makeAgain} →</TextSwap>
              </a>
            </div>
          </section>
        )}

        {/* Founder, 2026-09-11: the complaint has a place to go, on the page it is about. */}
        {finished && (
          <section id="feedback" data-render-feedback={feedback ? feedback.status : 'none'} className="mt-14 max-w-detail scroll-mt-24 border-t border-hairline pt-8">
            <p className="font-mono text-[0.75rem] leading-relaxed opacity-50">{r.aiNote}</p>
            <p className="mt-6 font-display text-[clamp(1.2rem,2.2vw,1.6rem)] leading-[0.95] font-black uppercase">{r.feedback.title}</p>
            <p className="mt-3 text-body opacity-70">{r.feedback.lede}</p>

            {feedbackOutcome === 'sent' && (
              <div data-feedback-sent role="status" className="mt-6 border border-accent px-4 py-3">
                <p className="font-label text-label uppercase">{r.feedback.sentTitle}</p>
                <p className="mt-1 text-[0.9rem] opacity-70">{r.feedback.sentBody}</p>
              </div>
            )}
            {feedbackOutcome === 'invalid' && (
              <p data-feedback-error role="alert" className="mt-6 border border-accent px-4 py-3 text-[0.9rem] text-accent">
                {r.feedback.errInvalid}
              </p>
            )}
            {feedback && feedbackOutcome !== 'sent' && (
              <p data-feedback-existing className="mt-6 font-mono text-[0.75rem] opacity-60">
                {interpolate(r.feedback.existing, { date: formatDate(feedback.updatedAt, locale) ?? '', status: r.feedback.statuses[feedback.status] })}
              </p>
            )}

            <form action={submitFeedbackAction} data-feedback-form className="mt-6 flex flex-col gap-5">
              <input type="hidden" name="renderId" value={job.id} />
              <fieldset>
                <legend className="sr-only">{r.feedback.title}</legend>
                <div className="flex flex-col gap-2">
                  {FEEDBACK_REASONS.map((reason) => (
                    <label key={reason} className="flex items-center gap-3 text-[0.95rem]">
                      <input type="radio" name="reason" value={reason} required defaultChecked={feedback?.reason === reason} className="h-4 w-4" style={{ accentColor: 'var(--accent)' }} />
                      {r.feedback.reasons[reason]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                <span className="block font-label text-eyebrow uppercase opacity-60">{r.feedback.message}</span>
                <textarea name="message" rows={3} maxLength={2000} defaultValue={feedback?.message ?? ''} className="mt-2 w-full border border-hairline bg-transparent px-4 py-3 text-body focus:outline focus:outline-2 focus:outline-accent" />
                <span className="mt-1 block font-mono text-[0.7rem] opacity-45">{r.feedback.messageHint}</span>
              </label>
              <div>
                <button type="submit" className="inline-block border border-current px-6 py-3 font-label text-label uppercase">
                  {r.feedback.submit} →
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
