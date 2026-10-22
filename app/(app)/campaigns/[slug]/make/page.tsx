import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { localize } from '@/lib/i18n/format';
import { loadApplyState } from '@/lib/campaigns/service';
import { loadCreatorProduction } from '@/lib/campaigns/production';
import { campaignMakePath, MY_CAMPAIGNS_PATH, campaignHref } from '@/lib/campaigns/links';
import { signInHref } from '@/lib/billing/links';
import { renderHref } from '@/lib/renders/share';
import { AppHeader } from '@/components/app/app-header';
import { CampaignCreate } from '@/components/campaigns/production-create';
export const dynamic = 'force-dynamic';
export default async function CampaignMakePage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, locale, viewer, sql] = await Promise.all([params, getLocaleFromHeaders(), getViewer(), getSqlRunner()]);
  const dict = getDictionary(locale), t = dict.campaigns.production, path = campaignMakePath(slug);
  if (!viewer.userId) return <div data-section data-theme="light" className="section min-h-screen"><AppHeader locale={locale} dict={dict} rest={path} /><main id="main" className="band py-16"><h1 className="font-display text-title">{t.title}</h1><a href={signInHref(path, locale)} className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-white">{dict.auth.signIn} →</a></main></div>;
  if (!sql) notFound();
  const apply = await loadApplyState({ sql }, slug, viewer.userId);
  if (!apply?.existing) notFound();
  const state = await loadCreatorProduction(sql, viewer.userId, apply.existing.id);
  if (!state) notFound();
  return <div data-section data-theme="light" className="section min-h-screen"><AppHeader locale={locale} dict={dict} rest={path} />
    <main id="main" data-campaign-make className="band py-12 lg:py-20"><div className="mx-auto max-w-2xl">
      <a href={MY_CAMPAIGNS_PATH} className="text-sm opacity-60">← {t.back}</a>
      <a href={campaignHref(locale, slug)} className="mt-8 block text-sm text-accent">{localize(apply.campaign.title, locale)}</a>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1><p className="mt-5 leading-relaxed opacity-70">{t.intro}</p><p className="mt-4 rounded-xl bg-accent/5 p-4 text-sm text-accent">{t.sponsored}</p>
      {state.preview && <figure className="mt-8" data-campaign-format-preview><figcaption className="mb-3 text-sm font-medium">{t.preview}</figcaption>{state.preview.mime.startsWith('video/') ? <video src={state.preview.href} controls muted playsInline preload="metadata" aria-label={t.preview} className="max-h-[30rem] w-full rounded-xl bg-black object-contain" /> : <img src={state.preview.href} alt={t.preview} className="max-h-[30rem] w-full rounded-xl object-contain" />}</figure>}
      {state.canCreate ? <CampaignCreate applicationId={apply.existing.id} locale={locale} copy={t} photoGuide={dict.selfie} /> : <p role="status" className="mt-8 rounded-xl border border-hairline p-5 text-sm leading-relaxed">{state.job?.status === 'failed' && state.blockedReason === 'generation_used' ? t.retryPending : t.errors[state.blockedReason as keyof typeof t.errors] ?? t.unavailable}</p>}
      {state.job && <a href={renderHref(state.job.id)} className="mt-5 inline-block rounded-full border border-current px-5 py-3 text-sm">{t.result} · {t.states[state.job.status as keyof typeof t.states]} →</a>}
      <section className="mt-12 border-t border-hairline pt-8"><h2 className="font-semibold">{t.nextTitle}</h2><p className="mt-3 text-sm leading-relaxed opacity-70">{t.next}</p><p className="mt-3 break-words text-sm">{[dict.campaigns.reqDisclosure, ...apply.campaign.requirements.hashtags.map(h => `#${h}`), ...apply.campaign.requirements.mentions.map(m => `@${m}`)].join(' · ')}</p></section>
    </div></main></div>;
}
