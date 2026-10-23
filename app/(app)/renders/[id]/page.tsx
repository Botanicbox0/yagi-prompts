import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { absoluteUrl } from '@/lib/seo/site-url';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { identityVerifyHref } from '@/lib/identity/links';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { failureReason, loadOwnRender } from '@/lib/renders/service';
import { FEEDBACK_REASONS, loadRenderFeedback } from '@/lib/renders/feedback';
import { estimateRenderMinutes } from '@/lib/renders/eta';
import { loadRenderExtras } from '@/lib/renders/extras';
import { submitFeedbackAction } from './actions';
import { RENDERS_PATH, renderHref, renderMediaHref, shareHref } from '@/lib/renders/share';
import { AppHeader } from '@/components/app/app-header';
import { AutoRefresh } from '@/components/renders/auto-refresh';
import { ResultMedia } from '@/components/renders/result-media';
import { PosterCapture } from '@/components/renders/poster-capture';
import { RenderStages } from '@/components/renders/render-stages';
import { renderStage } from '@/components/renders/stage';
import { WaitBrowse, pickWaitCards } from '@/components/renders/wait-browse';
import { ShareResult } from '@/components/renders/share-result';
import { TextSwap } from '@/components/ui/text-swap';
import { NotifyChoice } from '@/components/notify/notify-choice';

/**
 * `/renders/[id]` — the owner's result page. Queued or running: three named stages with a
 * measured estimate, a page that refreshes itself and nudges the queue (a film waiting on the
 * provider is polled here, so a reader who keeps the page open sees it finish without any cron),
 * and other formats to look at meanwhile. Finished: the object first, then download · share ·
 * one more (docs/PLATFORM-2.0.md §3.2-4·5). Failed: why, in their language, the refund, the way back.
 */
export const dynamic = 'force-dynamic';

/** A job still queued this long after it was created was not picked up by the enqueue request. */
const STRANDED_AFTER_MS = 45_000;

const ACTION_BASE = 'inline-flex min-h-11 items-center justify-center rounded-full px-4 py-1 text-center text-sm leading-tight font-semibold break-keep';
const ACTION_PRIMARY = `${ACTION_BASE} bg-accent text-white`;
const ACTION_SECONDARY = `${ACTION_BASE} border border-black/80`;

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
  // 0055: when the provider's "done" was seen (the third stage) and whether the film has its frame.
  const extras = pending || job.status === 'succeeded' ? await loadRenderExtras(sql, job.id) : null;
  const stage = pending || held ? renderStage({ ...job, finishingAt: extras?.finishingAt ?? null }) : null;
  const [eta, catalog] = stage === null
    ? [null, null]
    : await Promise.all([
        estimateRenderMinutes(sql, { engine: job.engine, templateId: job.templateId, medium: job.medium }),
        getPromptCatalog().catch(() => null),
      ]);

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
  const shareUrl = job.shareToken && job.shareExpiresAt ? absoluteUrl(shareHref(job.id, job.shareToken)) : null;
  const ready = job.status === 'succeeded' && job.resultMime !== null;
  // The share card's frame comes from the owner's browser (no ffmpeg on the server): once, quietly.
  const captureFrame = ready && job.resultMime!.startsWith('video/') && shareUrl !== null && extras?.ready === true && extras.posterKey === null;

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={`${RENDERS_PATH}/${job.id}`} />
      {(pending || held) && <AutoRefresh since={job.createdAt} />}

      <main id="main" data-render={job.id} data-status={job.status} className={`band ${ready ? 'pt-2 pb-16 lg:pt-6 lg:pb-20' : 'py-16 lg:py-20'}`}>
        <a href={RENDERS_PATH} className="inline-flex min-h-11 items-center font-mono text-[0.72rem] text-black/70">
          ← {r.title}
        </a>

        {/* §3.2-5: the object first, sized so a portrait film and the row of actions share the
            first screen (`--result-chrome` is what sits above the film, plus the row on a phone).
            On a desktop the actions sit beside the film, at its foot. */}
        {ready && (
          <div className="mt-1 [--result-chrome:16.5rem] lg:flex lg:items-end lg:gap-10 lg:[--result-cap:40rem] lg:[--result-chrome:11.5rem]">
            <div className="lg:shrink-0">
              <ResultMedia src={mediaSrc} mime={job.resultMime!} aspect={job.aspect} alt={title} />
              {captureFrame && <PosterCapture renderId={job.id} src={mediaSrc} />}
            </div>
            <section data-render-result className="mt-4 max-w-detail lg:mt-0 lg:min-w-0 lg:pb-1">
              {/* Three things to do with it, in the order people do them. One row from 360px up:
                  the last action takes what is left and may wrap its words. */}
              <div data-result-actions className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-stretch gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                <a href={downloadSrc} data-result-action="download" data-render-download className={ACTION_PRIMARY}>
                  {r.download} ↓
                </a>
                {shareUrl && (
                  <ShareResult
                    url={shareUrl}
                    title={title}
                    className={ACTION_SECONDARY}
                    labels={{ share: r.share, copied: r.shareCopied, failed: r.shareFailed }}
                  />
                )}
                <a href={templatesHref(locale, 'video')} data-result-action="again" className={ACTION_SECONDARY}>
                  {r.oneMore}
                </a>
              </div>
              <h1 className="mt-6 text-[1.35rem] leading-tight font-bold break-keep">{title}</h1>
              <p className="mt-1 font-mono text-[0.75rem] text-black/70">
                {dict.nav[job.medium]} · {job.aspect} · {formatDate(job.finishedAt ?? job.createdAt, locale) ?? ''}
              </p>
              {job.shareExpiresAt && shareUrl && (
                <p className="mt-3 font-mono text-[0.75rem] opacity-70">
                  {interpolate(r.shareNote, { date: formatDate(job.shareExpiresAt, locale) ?? '' })}
                </p>
              )}
            </section>
          </div>
        )}

        {!ready && (
          <>
            <p className="text-accent mt-6 font-label text-eyebrow uppercase">{r.detailEyebrow}</p>
            <h1 className="mt-4 font-display text-[clamp(2rem,4.5vw,3.4rem)] leading-[0.95] font-black uppercase">{title}</h1>
            <p className="mt-4 font-mono text-[0.78rem] opacity-60">
              {dict.nav[job.medium]} · {job.aspect} · {formatDate(job.createdAt, locale) ?? ''}
            </p>
          </>
        )}

        {stage !== null && eta !== null && <RenderStages stage={stage} minutes={eta.minutes} dict={dict} />}

        {held && (
          <section data-render-held className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{r.heldTitle}</p>
            <p className="mt-5 text-body opacity-70">{r.heldBody}</p>
            <a href={identityVerifyHref(renderHref(job.id))} data-identity-door className="mt-8 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
              <TextSwap>{dict.identity.start} →</TextSwap>
            </a>
          </section>
        )}

        <NotifyChoice dict={dict} context="render" status={job.status} />

        {job.status === 'failed' && (
          <section data-render-failed className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{r.failedTitle}</p>
            <p className="mt-5 text-body">{failureReason(job.errorCode, locale)}</p>
            {/* The refund is the sentence a reader looks for first after a failure: full ink, framed. */}
            <p data-render-refund className="mt-4 border-l-2 border-accent pl-3 text-body">{r.notCharged}</p>
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

        {stage !== null && catalog !== null && (
          <WaitBrowse cards={pickWaitCards(catalog, { medium: job.medium, exclude: job.templateSlug })} locale={locale} dict={dict} />
        )}

        {/* Founder, 2026-09-11: the complaint has a place to go, on the page it is about. */}
        {finished && (
          <section id="feedback" data-render-feedback={feedback ? feedback.status : 'none'} className="mt-14 max-w-detail scroll-mt-24 border-t border-hairline pt-8">
            <p className="font-mono text-[0.75rem] leading-relaxed opacity-70">{r.aiNote}</p>
            <p className="mt-6 font-display text-[clamp(1.2rem,2.2vw,1.6rem)] leading-[0.95] font-black uppercase">{r.feedback.title}</p>
            <p className="mt-3 text-body opacity-70">{r.feedback.lede}</p>

            {feedbackOutcome === 'sent' && (
              <div data-feedback-sent role="status" className="mt-6 border border-accent px-4 py-3">
                <p className="font-label text-label uppercase">{r.feedback.sentTitle}</p>
                <p className="mt-1 text-[0.9rem] opacity-70">{r.feedback.sentBody}</p>
              </div>
            )}
            {/* Audit P2-10: every non-`sent` outcome says something — `unavailable`, `not_found`
                and `sign_in_required` used to fail in silence. */}
            {feedbackOutcome !== null && feedbackOutcome !== 'sent' && (
              <p data-feedback-error={feedbackOutcome === 'invalid' ? 'invalid' : 'unavailable'} role="alert" className="mt-6 border border-accent px-4 py-3 text-[0.9rem] text-accent">
                {feedbackOutcome === 'invalid' ? r.feedback.errInvalid : r.feedback.errUnavailable}
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
                <span className="mt-1 block font-mono text-[0.7rem] opacity-70">{r.feedback.messageHint}</span>
              </label>
              <div>
                <button type="submit" className="inline-block border border-current px-6 py-3 font-label text-label uppercase">
                  {r.feedback.submit} →
                </button>
              </div>
            </form>
          </section>
        )}
        {finished&&process.env.TWINGS_COMMUNITY==='on'?<a href={`/community?render=${job.id}`} className="mt-8 inline-flex min-h-12 items-center rounded-full border border-current px-6 py-3 text-sm">{dict.community.ratingTitle}</a>:null}
      </main>
    </div>
  );
}
