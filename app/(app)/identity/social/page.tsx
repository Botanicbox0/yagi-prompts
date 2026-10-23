import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { campaignsHref } from '@/lib/campaigns/links';
import { SOCIAL_PATH, influencersOpen, isInfluencer, socialReady } from '@/lib/influencers/rules';
import { listSocialAccounts } from '@/lib/influencers/service';
import { AppHeader } from '@/components/app/app-header';
import { SocialAccountsPanel, type SocialState } from '@/components/identity/social-accounts';

/**
 * `/identity/social` — link an SNS account for influencer campaigns (docs/PLATFORM-2.0.md §17.1).
 * Session-gated app surface (`/identity` is in APP_PREFIXES). With TWINGS_INFLUENCERS off the page
 * says "준비 중" and links the campaigns everyone can join.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function SocialPage() {
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(SOCIAL_PATH)}`);
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const copy = dict.social;
  const open = influencersOpen();
  let initial: SocialState | null = null;
  if (open) {
    try {
      const sql = await getSqlRunner();
      if (sql && (await socialReady(sql))) {
        const [items, influencer] = await Promise.all([listSocialAccounts(sql, viewer.userId), isInfluencer(sql, viewer.userId)]);
        initial = { influencer, items };
      }
    } catch { /* Missing cloud migration: the page says so instead of a 500. */ }
  }
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={SOCIAL_PATH} />
      <main id="main" data-identity-social data-social-open={open ? 'true' : 'false'} className="mx-auto w-full max-w-xl px-4 py-10 sm:px-8 sm:py-14">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-black">{open ? copy.title : copy.closedTitle}</h1>
        <p className="mt-4 text-body leading-relaxed opacity-70">{open ? copy.intro : copy.closedBody}</p>
        <div className="mt-8">
          {!open ? (
            <a href={campaignsHref(locale)} data-social-closed className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 text-sm font-semibold text-white">{copy.closedCta} →</a>
          ) : initial ? (
            <SocialAccountsPanel copy={copy} locale={locale} initial={initial} signinHref={`/auth/signin?next=${encodeURIComponent(SOCIAL_PATH)}&locale=${locale}`} />
          ) : (
            <p role="status" className="text-sm leading-relaxed">{copy.errors.unavailable}</p>
          )}
        </div>
        <p className="mt-10 text-sm"><a href="/account" className="inline-flex min-h-11 items-center underline underline-offset-4">← {copy.back}</a></p>
      </main>
    </div>
  );
}
