import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';
import { siteLinks } from '@/components/marketing/chrome';
import { TwingsLogo } from '@/components/brand/twings-mark';
import { portraitEnabled } from '@/lib/identity/portrait-runtime';
import { TextSwap } from '@/components/ui/text-swap';
import { deletionMailto } from '@/components/app/deletion-mailto';
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
import { CreatorProfileCard } from '@/components/app/creator-profile';
import { loadCreatorProfile, type CreatorProfile } from '@/lib/creators/profile';
import { saveNotificationPreferences } from './actions';

/**
 * `/account` — private creator profile, activity and email preferences.
 *
 * Profile name and existing campaign SNS, notification toggles, locale, activity, sign out and
 * deletion request. No public projection contains this page's email or social profile.
 *
 * Any signed-in creator can save notifications. The old Pro-only restriction is retired.
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
  let profile: CreatorProfile | null = null;
  try {
    viewer = await getViewer();
    if (viewer.userId !== null) {
      const sql = await getSqlRunner();
      if (sql !== null) {
        const [prefs, works, creator] = await Promise.allSettled([
          loadPreferences(sql, viewer.userId), listMyRenders(sql, viewer.userId, 3), loadCreatorProfile(sql, viewer.userId),
        ]);
        if (prefs.status === 'fulfilled') preferences = prefs.value ?? PREFERENCES_OFF;
        if (works.status === 'fulfilled') renders = works.value;
        if (creator.status === 'fulfilled') profile = creator.value;
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
          {dict.creatorProfile.title}
        </h1>

        {viewer?.userId && <CreatorProfileCard profile={profile} email={viewer.email} dict={dict} locale={locale} feedback={params.profile} />}
        <div className="mt-8 max-w-detail">
          <dl>
            <Row term={copy.languageHeading}>
              <LocaleToggle current={locale} rest="/account" prefixed={false} />
            </Row>
          </dl>
        </div>

        {viewer?.userId && portraitEnabled() ? <div className="mt-10 max-w-detail border-t border-hairline pt-6"><a data-portrait-account href="/identity/portrait" className="inline-flex min-h-12 items-center rounded-full border border-current px-6 py-3">{dict.portrait.manage} →</a><p className="mt-3 text-sm opacity-65">{dict.portrait.allowance}</p></div> : null}
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
              {params.notif === 'err' && <p role="alert" className="mt-4 text-sm text-accent">{dict.creatorProfile.notificationError}</p>}
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
              href={deletionMailto(copy, viewer?.email ?? null)}
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
