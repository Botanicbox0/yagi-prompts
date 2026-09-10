import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { loadApplyState } from '@/lib/campaigns/service';
import { payoutSentence } from '@/lib/campaigns/copy';
import { MY_CAMPAIGNS_PATH, campaignApplyPath, campaignHref } from '@/lib/campaigns/links';
import { PITCH_MAX, URL_MAX, isApplyField, type ApplyField } from '@/lib/campaigns/schemas';
import { AppHeader } from '@/components/app/app-header';
import { campaignLabels } from '@/components/campaigns/labels';
import { TextSwap } from '@/components/ui/text-swap';
import { applyAction } from './actions';

/**
 * `/campaigns/[slug]/apply` — the login-gated application form (docs/CAMPAIGNS.md §6).
 *
 * JS-free (plain POST + `?ok/err` codes) like the contest entry form: the refusal names the field,
 * the page marks it, and everything a creator agreed to — the brief, the disclosure rule, the
 * payout sentence — is printed on this page above the consent box, so "I agreed" means something.
 */
export const dynamic = 'force-dynamic';

const INPUT = 'w-full border border-hairline bg-transparent px-3 py-2 font-mono text-code outline-none focus:border-accent';
const LABEL = 'block font-label text-eyebrow uppercase opacity-60';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function CampaignApplyPage({
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
  const c = dict.campaigns;
  const labels = campaignLabels(dict);

  const sql = await getSqlRunner();
  const state = sql === null ? null : await loadApplyState({ sql }, slug, viewer.userId);
  if (state === null) notFound();

  const { campaign, existing, open, slotsLeft } = state;
  const title = localize(campaign.title, locale);
  const ok = one(query, 'ok') === '1';
  const err = one(query, 'err');
  const badField: ApplyField | null = err === 'invalid' && isApplyField(one(query, 'field')) ? (one(query, 'field') as ApplyField) : null;
  const fieldClass = (name: ApplyField) => `${INPUT} mt-2${badField === name ? ' border-accent' : ''}`;
  const errorMessage = (() => {
    switch (err) {
      case 'sign_in_required':
        return c.errSignIn;
      case 'rate_limited':
        return c.errRateLimited;
      case 'not_open':
        return c.errNotOpen;
      case 'not_found':
        return c.errNotFound;
      case 'slots_full':
        return c.errSlotsFull;
      case 'locked':
        return c.errLocked;
      case 'invalid':
        return c.errInvalid;
      default:
        return null;
    }
  })();

  const canEdit = open && slotsLeft > 0 && (existing === null || existing.status === 'applied');
  const payout = campaign.payout ? payoutSentence(campaign.payout, locale, labels.payout) : null;

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={campaignApplyPath(slug)} />

      <main id="main" className="band py-16 lg:py-20">
        <a href={campaignHref(locale, slug)} className="font-mono text-[0.72rem] opacity-60">
          ← {title}
        </a>
        <p className="text-accent mt-6 font-label text-eyebrow uppercase">{c.eyebrow}</p>
        <h1 className="mt-4 max-w-detail font-display text-title font-black uppercase">
          {ok ? c.applySuccessTitle : existing && existing.status !== 'applied' ? c.applyStatusTitle : c.applyTitle}
        </h1>
        <p className="mt-6 max-w-detail text-body opacity-70">
          {ok ? c.applySuccessBody : c.applyLede}
        </p>

        {errorMessage && (
          <p role="alert" data-apply-error={err} className="text-accent mt-6 max-w-detail border border-accent px-4 py-3 text-[0.95rem]">
            {errorMessage}
          </p>
        )}

        {/* What is being agreed to — the terms, printed, not linked. */}
        <dl data-apply-terms className="mt-10 grid max-w-detail gap-x-8 gap-y-2 border-t border-hairline pt-6 font-mono text-[0.8rem] sm:grid-cols-[auto_1fr]">
          <dt className="opacity-50">{labels.payoutLabel}</dt>
          <dd>{payout ?? '—'}</dd>
          <dt className="opacity-50">{c.reqPlatforms}</dt>
          <dd>{campaign.platforms.map((p) => labels.platform[p]).join(' · ')} · {labels.deliverable[campaign.deliverable]}</dd>
          <dt className="opacity-50">{c.timelineHeading}</dt>
          <dd>
            {campaign.applicationsCloseAt ? interpolate(labels.applyBy, { date: formatDate(campaign.applicationsCloseAt, locale) ?? '' }) : '—'}
            {' · '}
            {campaign.postDeadlineAt ? interpolate(labels.postBy, { date: formatDate(campaign.postDeadlineAt, locale) ?? '' }) : '—'}
          </dd>
          {campaign.requirements.disclosure && (
            <>
              <dt className="opacity-50">{c.reqDisclosureLabel}</dt>
              <dd className="text-accent">{c.reqDisclosure}</dd>
            </>
          )}
          <dt className="opacity-50">{c.slotsLabel}</dt>
          <dd>{interpolate(labels.slotsLine, { left: String(slotsLeft), slots: String(campaign.slots) })}</dd>
        </dl>

        {viewer.userId === null ? (
          <div className="mt-10 max-w-detail">
            <p className="text-body opacity-70">{c.applySignInBody}</p>
            <a
              href={signInHref(campaignApplyPath(slug), locale)}
              data-apply-signin
              className="mt-6 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase"
            >
              <TextSwap>{dict.auth.signIn} →</TextSwap>
            </a>
          </div>
        ) : existing !== null && existing.status !== 'applied' ? (
          <div data-apply-status={existing.status} className="mt-10 max-w-detail border border-hairline p-6">
            <p className="font-label text-eyebrow uppercase opacity-60">{c.applyStatusLabel}</p>
            <p className="mt-2 font-display text-[1.5rem] leading-none font-black uppercase">{c.appStatus[existing.status]}</p>
            <a href={MY_CAMPAIGNS_PATH} className="text-accent mt-6 inline-block font-label text-label uppercase">
              <TextSwap>{c.myCampaigns} →</TextSwap>
            </a>
          </div>
        ) : !canEdit ? (
          <p data-apply-closed className="mt-10 max-w-detail border border-hairline p-6 text-body opacity-70">
            {slotsLeft === 0 ? c.slotsFullNotice : labels.applyClosed}
          </p>
        ) : (
          <form action={applyAction} data-apply-form className="mt-10 flex max-w-detail flex-col gap-6">
            <input type="hidden" name="slug" value={slug} />
            <label className="block">
              <span className={LABEL}>{c.fieldPitch}</span>
              <textarea
                name="pitch"
                rows={4}
                required
                minLength={10}
                maxLength={PITCH_MAX}
                defaultValue={existing?.pitch ?? ''}
                className={fieldClass('pitch')}
                {...(badField === 'pitch' ? { 'aria-invalid': true } : {})}
              />
              <span className="mt-1.5 block font-mono text-[0.72rem] opacity-45">{c.fieldPitchHint}</span>
            </label>
            <label className="block">
              <span className={LABEL}>{c.fieldSns}</span>
              <input
                type="url"
                name="snsUrl"
                required
                maxLength={URL_MAX}
                defaultValue={existing?.snsUrl ?? ''}
                placeholder="https://instagram.com/…"
                className={fieldClass('snsUrl')}
                {...(badField === 'snsUrl' ? { 'aria-invalid': true } : {})}
              />
            </label>
            <label className="block">
              <span className={LABEL}>{c.fieldFollowers}</span>
              <input
                type="number"
                name="followerCount"
                required
                min={0}
                step={1}
                defaultValue={existing?.followerCount ?? ''}
                className={fieldClass('followerCount')}
                {...(badField === 'followerCount' ? { 'aria-invalid': true } : {})}
              />
            </label>
            <label className="flex items-start gap-3 text-[0.9rem] leading-snug">
              <input type="checkbox" name="consent" required className="mt-1" />
              <span className={badField === 'consent' ? 'text-accent' : ''}>{c.fieldConsent}</span>
            </label>
            <div>
              <button type="submit" className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
                <TextSwap>{existing ? c.applyUpdate : c.applySubmit}</TextSwap>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
