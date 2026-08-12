import { getViewer } from '@/lib/auth/viewer';
import { loadSubscription, type SubscriptionRecord } from '@/lib/billing/reconcile';
import { isBillingConfigured } from '@/lib/billing/stripe-gateway';
import { PORTAL_ACTION, UPGRADE_PATH, signInHref } from '@/lib/billing/links';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { LocaleToggle } from '@/components/locale-toggle';
import { GoatMark } from '@/components/nav/goat-mark';
import { TextSwap } from '@/components/ui/text-swap';
import { BillingUnavailable } from '@/components/billing/upgrade-cta';
import {
  loadPreferences,
  PREFERENCES_OFF,
  type NotificationPreferences,
} from '@/lib/notify/preferences';
import { loadSubmissionsByAuthor, type PromptRow } from '@/lib/prompts/repo';
import { promptHref, promptsHref, PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import { saveNotificationPreferences } from './actions';

/**
 * `/account` — PLAN §3.7 + §3.5.
 *
 * Contents, exactly: plan status, the Stripe portal link, the **notification toggles** (M5), the
 * locale preference, sign out, and the deletion request.
 *
 * Plan status is shown from the stored row but DERIVED from the entitlement rule (§3.4): the copy
 * reads `subscriptions.status` through `isEntitled`, never `profiles.plan`, which is a mirror.
 * `cancel_at_period_end` is deliberately NOT a separate plan state — it is a note on an active
 * subscription ("access runs until … then stops"), because Stripe keeps the status `active` until
 * the period actually closes and the UI must not claim otherwise.
 *
 * The toggles follow the same rule: they exist for an entitled reader and are replaced by the pitch
 * line for everyone else (§3.5 "Toggles on /account (Pro)"). A disabled checkbox would be a control
 * that lies about being available; a sentence explaining what Pro is for does not.
 */
export const dynamic = 'force-dynamic';

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-hairline py-5">
      <dt className="font-label text-eyebrow uppercase opacity-60">{term}</dt>
      <dd className="mt-2 text-body">{children}</dd>
    </div>
  );
}

/**
 * A plain checkbox with its own explanation. No JavaScript: the form posts both switches together,
 * so an unchecked box arriving as *absent* is exactly "off" (see `actions.ts`).
 */
function Toggle({
  name,
  checked,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label htmlFor={name} className="mt-4 flex items-start gap-3">
      <input
        id={name}
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="mt-1 h-4 w-4 shrink-0"
        // `--accent` is a CSS variable, not a Tailwind palette entry (§5.1 — two inks, one accent).
        style={{ accentColor: 'var(--accent)' }}
      />
      <span>
        <span className="block text-body">{label}</span>
        <span className="block text-[0.875rem] opacity-60">{hint}</span>
      </span>
    </label>
  );
}

const DELETION_MAILTO = (email: string | null) => {
  const subject = encodeURIComponent('YAGI PROMPTS — account deletion request');
  const body = encodeURIComponent(
    [
      'Please delete my YAGI PROMPTS account.',
      '',
      `Account: ${email ?? '(the address I am signed in with)'}`,
      '',
      'I understand this cancels my subscription and removes my profile.',
    ].join('\n'),
  );
  return `mailto:hello@yagiworkshop.xyz?subject=${subject}&body=${body}`;
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const copy = dict.account;
  const params = (await searchParams) ?? {};

  let viewer = null as Awaited<ReturnType<typeof getViewer>> | null;
  let subscription: SubscriptionRecord | null = null;
  let preferences: NotificationPreferences = PREFERENCES_OFF;
  let submissions: PromptRow[] = [];
  try {
    viewer = await getViewer();
    if (viewer.userId !== null) {
      const sql = await getSqlRunner();
      if (sql !== null) {
        subscription = await loadSubscription(sql, viewer.userId);
        preferences = (await loadPreferences(sql, viewer.userId)) ?? PREFERENCES_OFF;
        // §13.1/E — "your submissions" list (slug, status, reject_reason when rejected).
        submissions = await loadSubmissionsByAuthor(sql, viewer.userId);
      }
    }
  } catch {
    // Placeholder env (§11) — render the shell honestly rather than a 500.
  }

  const entitled = subscription?.entitled === true || viewer?.tier === 'pro';
  const billingReady = isBillingConfigured();

  const statusLine = (() => {
    if (subscription === null) return null;
    switch (subscription.status) {
      case 'active':
        return copy.statusActive;
      case 'past_due':
        return copy.statusPastDue;
      case 'canceled':
        return copy.statusCanceled;
      default:
        return interpolate(copy.statusOther, { status: subscription.status });
    }
  })();

  const periodDate = formatDate(subscription?.currentPeriodEnd ?? null, locale);
  const periodLine =
    periodDate === null
      ? null
      : subscription?.cancelAtPeriodEnd === true
        ? interpolate(copy.endsOn, { date: periodDate })
        : interpolate(copy.renewsOn, { date: periodDate });

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell items-center justify-between px-gutter py-5">
          <a href={`/${locale}`} className="flex items-center gap-2.5">
            <GoatMark className="h-5 w-5" />
            <span className="font-display text-[1.05rem] leading-none font-black uppercase">
              {dict.meta.siteName}
            </span>
          </a>
          <div className="flex items-center gap-6">
            {/* §13.2 — the app chrome follows the nav pivot: prompts is the way back to the site. */}
            <a href={promptsHref(locale)} className="font-label text-eyebrow uppercase">
              {dict.nav.prompts}
            </a>
            <LocaleToggle current={locale} rest="/account" prefixed={false} />
          </div>
        </div>
      </header>

      <main id="main" className="band py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
        <h1 className="mt-6 max-w-detail font-display text-title font-black uppercase">
          {copy.title}
        </h1>

        <div className="mt-14 max-w-detail">
          <dl>
            <Row term={copy.emailLabel}>{viewer?.email ?? copy.notSignedIn}</Row>

            <Row term={copy.planHeading}>
              <span className="font-mono text-code">
                {entitled ? copy.planPro : copy.planFree}
              </span>
              {subscription?.cancelAtPeriodEnd === true && (
                <span className="text-accent ml-3 font-label text-eyebrow uppercase">
                  {copy.cancelScheduled}
                </span>
              )}
            </Row>

            {statusLine !== null && (
              <Row term={copy.statusHeading}>
                <span>{statusLine}</span>
                {periodLine !== null && (
                  <span className="mt-2 block font-mono text-code opacity-60">{periodLine}</span>
                )}
              </Row>
            )}

            <Row term={copy.languageHeading}>
              <LocaleToggle current={locale} rest="/account" prefixed={false} />
            </Row>
          </dl>
        </div>

        {/* --- billing -------------------------------------------------- */}
        <div className="mt-14 max-w-detail">
          {!billingReady ? (
            <BillingUnavailable
              title={dict.billing.unavailableTitle}
              body={dict.billing.unavailableBody}
            />
          ) : entitled ? (
            <div className="border border-hairline p-6 sm:p-8">
              <form method="post" action={`${PORTAL_ACTION}?locale=${locale}`}>
                <button
                  type="submit"
                  className="inline-block border border-current px-6 py-3 font-label text-label uppercase"
                >
                  <TextSwap>{copy.manageBilling} →</TextSwap>
                </button>
              </form>
              <p className="mt-4 font-mono text-code opacity-60">{copy.manageBillingHint}</p>
            </div>
          ) : (
            <aside className="border border-accent p-6 sm:p-8">
              <p className="font-display text-[clamp(1.35rem,2.2vw,1.75rem)] leading-[1] font-black uppercase">
                {copy.upgradeHeading}
              </p>
              <p className="mt-4 text-body opacity-70">{copy.upgradeBody}</p>
              <a
                href={viewer?.userId === null ? signInHref(UPGRADE_PATH, locale) : UPGRADE_PATH}
                className="text-accent mt-6 inline-block font-label text-label uppercase"
              >
                <TextSwap>{copy.upgradeCta} →</TextSwap>
              </a>
            </aside>
          )}
        </div>

        {/* --- notifications (§3.5) -------------------------------------- */}
        <div className="mt-14 max-w-detail border-t border-hairline pt-10">
          <p className="font-label text-eyebrow uppercase opacity-60">{copy.notifHeading}</p>
          <p className="mt-2 text-[0.9375rem] opacity-70">{copy.notifLede}</p>

          {entitled ? (
            <form action={saveNotificationPreferences} className="mt-6">
              <Toggle
                name="notifNewPlaybook"
                checked={preferences.newPlaybook}
                label={copy.notifNewLabel}
                hint={copy.notifNewHint}
              />
              <Toggle
                name="notifUpdates"
                checked={preferences.updates}
                label={copy.notifUpdatesLabel}
                hint={copy.notifUpdatesHint}
              />
              <button
                type="submit"
                className="mt-6 inline-block border border-current px-6 py-3 font-label text-label uppercase"
              >
                <TextSwap>{copy.notifSave}</TextSwap>
              </button>
              {params.notif === 'saved' && (
                <p className="text-accent mt-4 font-mono text-code">{copy.notifSaved}</p>
              )}
            </form>
          ) : (
            <p className="mt-4 max-w-detail text-[0.9375rem] opacity-70">{copy.notifProOnly}</p>
          )}
        </div>

        {/* --- §13.1/E your submissions --------------------------------- */}
        <div className="mt-14 max-w-detail border-t border-hairline pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <p className="font-label text-eyebrow uppercase opacity-60">
              {dict.submit.mySubmissions}
            </p>
            <a
              href={PROMPT_SUBMIT_PATH}
              className="text-accent font-label text-eyebrow uppercase"
            >
              <TextSwap>{dict.prompts.submitCta} →</TextSwap>
            </a>
          </div>

          {submissions.length === 0 ? (
            <p className="mt-4 text-[0.9375rem] opacity-70">{dict.submit.mySubmissionsEmpty}</p>
          ) : (
            <ul className="mt-6 flex flex-col gap-4">
              {submissions.map((row) => (
                <li
                  key={row.id}
                  data-submission={row.slug}
                  data-status={row.status}
                  className="border border-hairline p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-mono text-code">{row.title}</span>
                    <span className="font-label text-eyebrow uppercase opacity-60">
                      {row.status === 'published'
                        ? dict.submit.statusPublished
                        : row.status === 'rejected'
                          ? dict.submit.statusRejected
                          : row.status === 'archived'
                            ? dict.submit.statusArchived
                            : dict.submit.statusPending}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[0.72rem] opacity-45">{row.slug}</p>
                  {row.status === 'published' && (
                    <a
                      href={promptHref(locale, row.slug)}
                      className="text-accent mt-3 inline-block font-label text-eyebrow uppercase"
                    >
                      <TextSwap>{dict.prompts.openLabel} →</TextSwap>
                    </a>
                  )}
                  {row.status === 'rejected' && row.rejectReason && (
                    <p className="mt-3 border-t border-hairline pt-3 text-[0.9375rem] opacity-70">
                      <span className="font-label text-eyebrow uppercase opacity-60">
                        {dict.submit.rejectReasonLabel}
                      </span>
                      <span className="mt-1 block">{row.rejectReason}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- account actions ------------------------------------------ */}
        <div className="mt-14 flex max-w-detail flex-col gap-8 border-t border-hairline pt-10">
          <form method="post" action="/auth/signout">
            <button type="submit" className="font-label text-label uppercase">
              <TextSwap>{copy.signOut}</TextSwap>
            </button>
          </form>

          {/* §3.7 — v1 deletion is an honest REQUEST flow; the runbook ships with M5. */}
          <div>
            <p className="font-label text-eyebrow uppercase opacity-60">{copy.deletionHeading}</p>
            <p className="mt-2 text-[0.9375rem] opacity-70">{copy.deletionBody}</p>
            <a
              href={DELETION_MAILTO(viewer?.email ?? null)}
              className="text-accent mt-3 inline-block font-label text-eyebrow uppercase"
            >
              <TextSwap>{copy.deletionCta} →</TextSwap>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
