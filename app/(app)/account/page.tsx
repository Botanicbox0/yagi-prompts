import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';
import { AppHeader } from '@/components/app/app-header';
import { selfieLibrary, selfieLimit, type SelfieLibrary } from '@/lib/identity/selfie-service';
import { IDENTITY_SELFIE_PATH } from '@/lib/identity/links';
import { SelfieLibraryPanel } from '@/components/identity/selfie-grid';
import { TextSwap } from '@/components/ui/text-swap';
import { DeletionRequestStatus } from '@/components/account/deletion';
import { deletionGraceDays, deletionReady, openDeletionRequest, type DeletionRequest } from '@/lib/account/deletion';
import { interpolate } from '@/lib/i18n/format';
import { ACCOUNT_DELETE_PATH } from '@/lib/account/links';
import {
  loadPreferences,
  PREFERENCES_OFF,
  type NotificationPreferences,
} from '@/lib/notify/preferences';
import { campaignsHref, MY_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { templatesHref } from '@/lib/prompts/links';
import { listMyRenders, type RenderView } from '@/lib/renders/service';
import { RENDERS_PATH } from '@/lib/renders/share';
import { RenderList } from '@/components/renders/render-list';
import { CreatorProfileCard } from '@/components/app/creator-profile';
import { loadCreatorProfile, type CreatorProfile } from '@/lib/creators/profile';
import { saveNotificationPreferences } from './actions';
import { cancelDeletion } from './delete/actions';
import { CREATOR_WORKSPACE_PATH, creatorProgramOpen } from '@/lib/creator-platform/links';
import { SubscriptionStatus } from '@/components/billing/subscription-status';
import { subscriptionQaAllowed } from '@/lib/creator-subscriptions/access';
import { billingConfigFromEnv } from '@/lib/creator-subscriptions/gateway';
import { getSubscriptionSummary } from '@/lib/creator-subscriptions/service';
import type { SubscriptionSummary } from '@/lib/creator-subscriptions/types';
import { NotifyChoice } from '@/components/notify/notify-choice';
import { influencersOpen, isInfluencer } from '@/lib/influencers/rules';
import { listSocialAccounts, type SocialAccountView } from '@/lib/influencers/service';
import { SocialAccountCard } from '@/components/identity/social-teaser';

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
  let subscription: SubscriptionSummary | null = null;
  let subscriptionLoaded = false;
  let selfies: SelfieLibrary | null = null;
  let deletionRequest: DeletionRequest | null = null;
  const socialOpen = influencersOpen();
  let social: { influencer: boolean; items: SocialAccountView[] } | null = null;
  try {
    viewer = await getViewer();
    if (viewer.userId !== null) {
      const sql = await getSqlRunner();
      if (sql !== null) {
        const userId = viewer.userId;
        const subEnv = billingConfigFromEnv()?.kind === 'test' && subscriptionQaAllowed(viewer) ? 'test' : 'live';
        const [prefs, works, creator, monthly, face, deletion] = await Promise.allSettled([
          loadPreferences(sql, userId), listMyRenders(sql, userId, 3), loadCreatorProfile(sql, userId),
          getSubscriptionSummary(sql, userId, { environment: subEnv }), selfieLibrary(sql, userId, selfieLimit()),
          // An open deletion request replaces the link with its status.
          deletionReady(sql).then((ready) => (ready ? openDeletionRequest(sql, userId) : null)),
        ]);
        if (prefs.status === 'fulfilled') preferences = prefs.value ?? PREFERENCES_OFF;
        if (works.status === 'fulfilled') renders = works.value;
        if (creator.status === 'fulfilled') profile = creator.value;
        if (monthly.status === 'fulfilled') { subscription = monthly.value; subscriptionLoaded = true; }
        if (face.status === 'fulfilled') selfies = face.value;
        if (deletion.status === 'fulfilled') deletionRequest = deletion.value;
        // docs/PLATFORM-2.0.md §17.1 — the SNS card, only while TWINGS_INFLUENCERS is on.
        if (socialOpen) {
          social = await Promise.all([listSocialAccounts(sql, userId), isInfluencer(sql, userId)])
            .then(([items, influencer]) => ({ influencer, items }))
            .catch(() => ({ influencer: false, items: [] }));
        }
      }
    }
  } catch {
    // Placeholder env (§11) — render the shell honestly rather than a 500.
  }

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest="/account" />

      <main id="main" className="band py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
        <h1 className="mt-6 max-w-detail font-display text-title font-black uppercase">
          {dict.creatorProfile.title}
        </h1>

        {viewer?.userId && <CreatorProfileCard profile={profile} email={viewer.email} dict={dict} locale={locale} feedback={params.profile} />}
        {/* The saved photos (docs/IDENTITY-SELFIE.md): the first thing a creator needs, so the first card after the name. */}
        {viewer?.userId && (
          <section data-selfie-account data-selfie-present={selfies?.items.length ? 'true' : 'false'} aria-labelledby="account-selfie-title" className="mt-6 max-w-detail rounded-3xl border border-hairline bg-white p-5 sm:p-6">
            <h2 id="account-selfie-title" className="text-base font-semibold">{dict.selfie.panelTitle}</h2>
            <div className="mt-4">
              {/* Before the cloud migration the card still invites the first upload; the selfie page then says it is unavailable. */}
              <SelfieLibraryPanel
                copy={dict.selfie}
                locale={locale}
                variant="account"
                initial={selfies ?? { limit: selfieLimit(), defaultId: null, items: [] }}
                manageHref={IDENTITY_SELFIE_PATH}
                signinHref={`/auth/signin?next=${encodeURIComponent('/account')}&locale=${locale}`}
              />
            </div>
          </section>
        )}
        {viewer?.userId && socialOpen && <SocialAccountCard copy={dict.social} influencer={social?.influencer ?? false} items={social?.items ?? []} />}
        {viewer?.userId && (
          <section
            data-creator-campaign-hub
            aria-labelledby="account-campaign-hub-title"
            className="mt-6 max-w-detail rounded-3xl border border-hairline bg-white p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="account-campaign-hub-title" className="text-base font-semibold">
                {dict.campaigns.myCampaigns}
              </h2>
              <span className="font-mono text-xs opacity-60">{dict.nav.campaigns}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed opacity-75">
              {dict.creatorJourney.campaignBody}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href={MY_CAMPAIGNS_PATH}
                className="inline-flex min-h-11 items-center rounded-full bg-on-surface px-5 py-2.5 text-sm font-semibold text-surface"
              >
                {dict.campaigns.myCampaigns} →
              </a>
              <a
                href="/campaigns/open"
                className="inline-flex min-h-11 items-center rounded-full border border-hairline px-5 py-2.5 text-sm font-medium"
              >
                {dict.campaigns.railRecruiting}
              </a>
              <a
                href={campaignsHref(locale)}
                className="inline-flex min-h-11 items-center px-2 text-sm underline underline-offset-4 opacity-80"
              >
                {dict.creatorJourney.campaignCta} ↗
              </a>
              {creatorProgramOpen() && (
                <a
                  href={CREATOR_WORKSPACE_PATH}
                  className="inline-flex min-h-11 items-center rounded-full border border-hairline px-5 py-2.5 text-sm font-medium"
                >
                  {dict.creatorProgram.workspaceTitle} →
                </a>
              )}
            </div>
          </section>
        )}
        {viewer?.userId && <SubscriptionStatus initial={subscription} copy={dict.creatorSubscription} locale={locale} unavailable={!subscriptionLoaded} />}
        <div className="mt-8 max-w-detail">
          <dl>
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
              {params.notif === 'err' && <p role="alert" className="mt-4 text-sm text-accent">{dict.creatorProfile.notificationError}</p>}
            </form>
          ) : (
            <p className="mt-4 max-w-detail text-[0.9375rem] opacity-70">{copy.notifProOnly}</p>
          )}
          {/* docs/PLATFORM-2.0.md §5.3 — the completion push for this device, and the install card. */}
          {viewer?.userId && <NotifyChoice dict={dict} context="account" />}
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

          {/* Self-serve deletion (docs/RUNBOOK-deletion.md). The confirmation step lives at
              /account/delete and falls back to the mail request until 0064 is applied. */}
          <div id="account-deletion" data-account-deletion className="scroll-mt-24">
            <p className="font-label text-eyebrow uppercase opacity-60">{copy.deletionHeading}</p>
            {deletionRequest ? (
              <div className="mt-3">
                <DeletionRequestStatus copy={dict.accountDeletion} locale={locale} request={deletionRequest} cancel={cancelDeletion} />
              </div>
            ) : (
              <>
                <p className="mt-2 text-[0.9375rem] opacity-70">{interpolate(copy.deletionBody, { days: String(deletionGraceDays()) })}</p>
                <a href={ACCOUNT_DELETE_PATH} data-account-deletion-link className="text-accent mt-3 inline-block font-label text-eyebrow uppercase">
                  <TextSwap>{copy.deletionCta} →</TextSwap>
                </a>
              </>
            )}
          </div>
        </div>
        {process.env.TWINGS_COMMUNITY==='on'||process.env.TWINGS_FORMAT_CREATORS==='on'||process.env.TWINGS_IMAGE_REWARDS==='on'?<a href="/community" className="mt-8 mr-3 inline-flex min-h-12 items-center rounded-full border border-current px-6 py-3 text-sm">{dict.community.title}</a>:null}
        {viewer?.userId && creatorProgramOpen() ? <a href={CREATOR_WORKSPACE_PATH} data-creator-workspace-link className="mt-8 mr-3 inline-flex min-h-12 items-center rounded-full border border-current px-6 py-3 text-sm">{dict.creatorProgram.workspaceTitle}</a> : null}
      </main>
    </div>
  );
}
