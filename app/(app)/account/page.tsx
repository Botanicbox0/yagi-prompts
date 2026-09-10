import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';
import { siteLinks } from '@/components/marketing/chrome';
import { TwingsLogo } from '@/components/brand/twings-mark';
import { TextSwap } from '@/components/ui/text-swap';
import {
  loadPreferences,
  PREFERENCES_OFF,
  type NotificationPreferences,
} from '@/lib/notify/preferences';
import { MY_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { templatesHref } from '@/lib/prompts/links';
import { listMyRenders, type RenderView } from '@/lib/renders/service';
import { RENDERS_PATH } from '@/lib/renders/share';
import { RenderList } from '@/components/renders/render-list';
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
  const subject = encodeURIComponent('TWINGS — account deletion request');
  const body = encodeURIComponent(
    [
      'Please delete my TWINGS account.',
      '',
      `Account: ${email ?? '(the address I am signed in with)'}`,
      '',
      'I understand this removes my profile and everything I made.',
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
  let preferences: NotificationPreferences = PREFERENCES_OFF;
  let renders: RenderView[] = [];
  try {
    viewer = await getViewer();
    if (viewer.userId !== null) {
      const sql = await getSqlRunner();
      if (sql !== null) {
        preferences = (await loadPreferences(sql, viewer.userId)) ?? PREFERENCES_OFF;
        renders = await listMyRenders(sql, viewer.userId, 3);
      }
    }
  } catch {
    // Placeholder env (§11) — render the shell honestly rather than a 500.
  }

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell items-center justify-between px-gutter py-5">
          <a href={`/${locale}`} className="flex items-center gap-2.5">
            <TwingsLogo size={18} />
          </a>
          <div className="flex items-center gap-6">
            {siteLinks(locale, dict).map((link, index) => (
              <a
                key={link.href}
                href={link.href}
                className={[index === 0 ? '' : 'hidden sm:inline', 'font-label text-eyebrow uppercase'].join(' ')}
              >
                {link.label}
              </a>
            ))}
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

            <Row term={copy.languageHeading}>
              <LocaleToggle current={locale} rest="/account" prefixed={false} />
            </Row>
          </dl>
        </div>

        {/* --- notifications (§3.5) -------------------------------------- */}
        <div className="mt-14 max-w-detail border-t border-hairline pt-10">
          <p className="font-label text-eyebrow uppercase opacity-60">{copy.notifHeading}</p>
          <p className="mt-2 text-[0.9375rem] opacity-70">{copy.notifLede}</p>

          {/* Any signed-in reader (2026-09-03): the Pro plan that used to gate these is gone. */}
          {viewer?.userId ? (
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

        {/* --- activity: the two loops (docs/TEMPLATES-IA.md) ------------------------------- */}
        <div className="mt-14 max-w-detail border-t border-hairline pt-10">
          <p className="font-label text-eyebrow uppercase opacity-60">{copy.activityHeading}</p>
          <p className="mt-2 text-[0.9375rem] opacity-70">{copy.activityBody}</p>
          {renders.length > 0 && (
            <div className="mt-6">
              <RenderList items={renders} locale={locale} dict={dict} />
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={RENDERS_PATH} data-my-renders className="text-accent font-label text-eyebrow uppercase">
              <TextSwap>{dict.renders.title} →</TextSwap>
            </a>
            <a href={MY_CAMPAIGNS_PATH} data-my-campaigns className="text-accent font-label text-eyebrow uppercase">
              <TextSwap>{dict.campaigns.myCampaigns} →</TextSwap>
            </a>
            <a href={templatesHref(locale, 'video')} className="text-accent font-label text-eyebrow uppercase">
              <TextSwap>{dict.templates.ctaVideo} →</TextSwap>
            </a>
          </div>
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
