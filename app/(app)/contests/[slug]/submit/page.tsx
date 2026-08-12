import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { getEntryFormState } from '@/lib/contests/facade';
import { contestHref, contestSubmitPath, contestsHref } from '@/lib/contests/links';
import { contestTiming } from '@/lib/contests/phase';
import { ENTRY_NOTE_MAX, ENTRY_TITLE_MAX, URL_MAX } from '@/lib/contests/schemas';
import { GoatMark } from '@/components/nav/goat-mark';
import { TextSwap } from '@/components/ui/text-swap';
import { submitEntryAction } from './actions';

/**
 * `/contests/[slug]/submit` — PLAN §14.1/§14.2.
 *
 * UNPREFIXED app surface: login-gated at the edge (`isContestSubmitPath` in `lib/i18n/config.ts`),
 * `no-store` and `noindex` through the `(app)` layout and middleware. The contest it belongs to is
 * locale-prefixed and public; this is not, for the same reason `/account` is not.
 *
 * The form is deliberately plain: one POST to one server action, `?ok/err` codes back, no client
 * JavaScript. Every rule the copy mentions is enforced on the server against the real contest dates
 * (`lib/contests/submit.ts`), so what the entrant is told and what the server does are one rule.
 *
 * Four states, and each is a different page rather than a disabled version of the same one:
 *   · **open**       — the form, prefilled;
 *   · **upcoming**   — the opening date and the brief, because there is nothing to submit yet;
 *   · **closed**     — the deadline passed; the films are on the contest page;
 *   · **done**       — the confirmation, with what happens next.
 */
export const dynamic = 'force-dynamic';

const INPUT =
  'w-full border border-hairline bg-transparent px-3 py-2 font-mono text-code outline-none focus:border-accent';
const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function SubmitEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const [{ slug }, locale, viewer, query] = await Promise.all([
    params,
    getLocaleFromHeaders(),
    getViewer(),
    searchParams ?? Promise.resolve({} as SearchParams),
  ]);

  const dict = getDictionary(locale);
  const copy = dict.entry;
  const state = await getEntryFormState(slug, viewer.userId);
  // An unpublished contest has no entry form, exactly as it has no detail page.
  if (state === null) notFound();

  const { contest, existing, snsPrefill } = state;
  const timing = contestTiming(contest, Date.now());
  const title = localize(contest.title, locale);

  const ok = one(query, 'ok') === '1';
  const err = one(query, 'err');
  const errorMessage = (() => {
    switch (err) {
      case 'sign_in_required':
        return copy.errSignIn;
      case 'rate_limited':
        return copy.errRateLimited;
      case 'not_open':
        return copy.errNotOpen;
      case 'not_found':
        return copy.errNotFound;
      case 'invalid':
        return copy.errInvalid;
      default:
        return null;
    }
  })();

  const statusWord =
    existing === null
      ? ''
      : existing.status === 'approved'
        ? copy.statusApproved
        : existing.status === 'rejected'
          ? copy.statusRejected
          : copy.statusPending;

  const heading = ok
    ? copy.successTitle
    : timing.phase === 'closed'
      ? copy.closedTitle
      : timing.phase === 'upcoming'
        ? copy.upcomingTitle
        : copy.title;

  const lede = ok
    ? copy.successBody
    : timing.phase === 'closed'
      ? copy.closedBody
      : timing.phase === 'upcoming'
        ? interpolate(copy.upcomingBody, {
            date: formatDate(contest.startsAt, locale) ?? '',
          })
        : copy.lede;

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell items-center justify-between gap-4 px-gutter py-4">
          <a href={contestsHref(locale)} className="flex items-center gap-2.5">
            <GoatMark className="h-5 w-5" />
            <span className="font-display text-[1.05rem] leading-none font-black uppercase">
              {dict.meta.siteName}
            </span>
          </a>
          <a
            href={contestHref(locale, slug)}
            className="font-label text-eyebrow uppercase opacity-60"
          >
            <TextSwap>{dict.contests.backToList}</TextSwap>
          </a>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-detail px-gutter py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>

        {/* The contest this form belongs to, named before anything is asked. */}
        <p className="mt-4 font-label text-eyebrow uppercase opacity-55">
          {copy.contestLabel} · {contest.brandName}
        </p>
        <p className="mt-2 font-display text-[clamp(1.4rem,3vw,2rem)] leading-[0.95] font-black uppercase">
          <a href={contestHref(locale, slug)}>{title}</a>
        </p>
        {contest.deadlineAt && (
          <p className="mt-3 font-mono text-[0.78rem] opacity-55">
            {interpolate(copy.deadlineLine, {
              date: formatDate(contest.deadlineAt, locale) ?? '',
              dday: timing.dDay ?? dict.contests.phaseClosed,
            })}
          </p>
        )}

        <h1 className="mt-9 font-display text-[clamp(2rem,5vw,3.25rem)] leading-[0.95] font-black uppercase">
          {heading}
        </h1>
        <p className="mt-5 text-body opacity-70">{lede}</p>

        {ok ? (
          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href={contestHref(locale, slug)}
              className="text-accent inline-block border border-current px-5 py-2.5 font-label text-eyebrow uppercase"
            >
              <TextSwap>{copy.successBack} →</TextSwap>
            </a>
            <a
              href={contestSubmitPath(slug)}
              className="inline-block border border-hairline px-5 py-2.5 font-label text-eyebrow uppercase"
            >
              <TextSwap>{copy.resubmitButton} →</TextSwap>
            </a>
          </div>
        ) : timing.phase !== 'open' ? (
          <p className="mt-10">
            <a
              href={contestHref(locale, slug)}
              className="text-accent inline-block border border-current px-5 py-2.5 font-label text-eyebrow uppercase"
            >
              <TextSwap>{dict.contests.backToList} →</TextSwap>
            </a>
          </p>
        ) : (
          <>
            {errorMessage && (
              <p
                role="status"
                data-entry-error={err}
                className="mt-8 border border-accent px-4 py-3 font-label text-eyebrow uppercase"
              >
                {errorMessage}
              </p>
            )}

            {viewer.userId === null && (
              <p className="mt-8 border border-hairline px-4 py-3 text-body opacity-70">
                {copy.errSignIn}
              </p>
            )}

            {/* §14.2 — "resubmit notice when an entry exists (shows current status; resubmitting
                replaces + resets to pending)". Stated before the form, not after it. */}
            {existing && (
              <div data-entry-resubmit={existing.status} className="mt-8 border border-accent p-5">
                <p className="font-label text-eyebrow uppercase">{copy.resubmitHeading}</p>
                <p className="mt-2 text-[0.9375rem]">
                  {interpolate(copy.resubmitNotice, {
                    title: existing.title,
                    status: statusWord,
                  })}
                </p>
                {existing.status === 'rejected' && existing.rejectReason && (
                  <p className="mt-3 font-mono text-[0.78rem] opacity-70">
                    {copy.rejectReasonLabel}: {existing.rejectReason}
                  </p>
                )}
                <p className="mt-3 font-mono text-[0.75rem] opacity-55">{copy.resubmitWarning}</p>
              </div>
            )}

            <form action={submitEntryAction} className="mt-10 flex flex-col gap-8">
              {/* The contest is identified by the URL; this input only carries it back to the
                  action's redirect. The SERVER re-resolves the contest from it and refuses
                  anything unpublished, so it grants no authority. */}
              <input type="hidden" name="slug" value={slug} />

              <label className="block">
                <span className={LABEL}>{copy.fieldTitle}</span>
                <input
                  type="text"
                  name="title"
                  required
                  maxLength={ENTRY_TITLE_MAX}
                  defaultValue={existing?.title ?? ''}
                  className={`${INPUT} mt-2`}
                />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {copy.fieldTitleHint}
                </span>
              </label>

              <label className="block">
                <span className={LABEL}>{copy.fieldVideo}</span>
                <input
                  type="url"
                  name="videoUrl"
                  required
                  maxLength={URL_MAX}
                  placeholder="https://"
                  defaultValue={existing?.videoUrl ?? ''}
                  className={`${INPUT} mt-2`}
                />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {copy.fieldVideoHint}
                </span>
              </label>

              {/* §14.2 — the SNS field, with its one honest sentence directly above it. */}
              <div className="border border-hairline p-5">
                <label className="block">
                  <span className={LABEL}>{copy.fieldSns}</span>
                  <p data-sns-explain className="mt-2 text-[0.9375rem]">
                    {copy.fieldSnsExplain}
                  </p>
                  <input
                    type="url"
                    name="snsUrl"
                    required
                    maxLength={URL_MAX}
                    placeholder="https://"
                    defaultValue={snsPrefill ?? ''}
                    className={`${INPUT} mt-3`}
                  />
                  <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                    {copy.fieldSnsHint}
                  </span>
                </label>
              </div>

              <label className="block">
                <span className={LABEL}>{copy.fieldNote}</span>
                <textarea
                  name="note"
                  rows={4}
                  maxLength={ENTRY_NOTE_MAX}
                  defaultValue={existing?.note ?? ''}
                  className={`${INPUT} mt-2`}
                />
                <span className="mt-1.5 block font-mono text-[0.72rem] opacity-50">
                  {interpolate(copy.fieldNoteHint, { max: String(ENTRY_NOTE_MAX) })}
                </span>
              </label>

              <div className="border border-hairline p-5">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="consent"
                    required
                    className="mt-1 h-4 w-4 shrink-0"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="text-[0.9375rem]">{copy.consentLabel}</span>
                </label>
                <p className="mt-4 border-t border-hairline pt-4 font-mono text-[0.72rem] opacity-55">
                  {copy.consentTerms}
                </p>
              </div>

              <div>
                <button
                  type="submit"
                  className="border border-accent bg-accent px-6 py-3 font-label text-label text-white uppercase"
                >
                  {existing ? copy.resubmitButton : copy.submitButton}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
