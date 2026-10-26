import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { brandsHref, campaignsHref } from '@/lib/campaigns/links';
import { storefrontOpen } from '@/lib/auth/purchase-gate';
import type { EvidencePair } from '@/lib/content/slots';
import { CreatorPreview } from './creator-preview';
import { HeroEvidence } from './hero-evidence';
import { TypographicPoster } from '@/components/prompts/poster';
import { CreatorAvailabilityNotice } from '@/components/twings/subscription-public-notices';

/**
 * With a selfie → scene pair (the `heroEvidence()` content slot) the proof sits between the title
 * and the one CTA and the definition moves under them — evidence first (PLATFORM-2.0 §15.4). Without
 * one, the hero keeps its earlier shape exactly. The availability line follows `storefrontOpen()`,
 * the same value the template page and pricing read, so the three never disagree.
 */
export function CreatorHero({ dict, locale, featured, evidence = null }: { dict: Dictionary; locale: Locale; featured?: PromptCard; evidence?: EvidencePair | null }) {
  const t = dict.creatorJourney;
  const title = featured && (locale === 'ko' ? featured.titleKo || featured.title : featured.title);
  const measured = [featured?.video, featured?.poster].find(media => media?.w && media?.h && media.w > 0 && media.h > 0);
  // Generation's aspectDefault is not the uploaded example's framing. Unknown media keeps
  // the catalog's 16:9 preview window rather than inventing a portrait frame around a wide film.
  const ratio = measured ? `${measured.w} / ${measured.h}` : '16 / 9';
  const [ratioWidth, ratioHeight] = ratio.split('/').map(Number);
  const portrait = (ratioWidth ?? 16) < (ratioHeight ?? 9);
  const definition = <p data-service-definition className={`${evidence === null ? 'mt-6 text-base' : 'mt-8 text-sm'} max-w-lg leading-relaxed text-black/65`}>{t.body}</p>;
  return <section data-section data-theme="light" data-creator-hero data-hero-has-evidence={evidence === null ? undefined : ''} className="section">
    <div className="audience-shell grid items-center gap-10 pt-28 pb-12 lg:grid-cols-[0.98fr_1.02fr] lg:gap-12 lg:pt-32 lg:pb-20">
      <div className="flex flex-col justify-center">
        <p className="audience-eyebrow">{t.eyebrow}</p>
        <h1 className="audience-title mt-5 whitespace-pre-line">{t.title}</h1>
        {evidence === null && definition}
        <HeroEvidence pair={evidence} copy={t} />
        <div className={`${evidence === null ? 'mt-8' : 'mt-6'} flex flex-wrap items-center gap-5`}>
          <a href={templatesHref(locale, 'video')} data-hero-video className="audience-button">{t.browse} ↗</a>
          <a href="#how-it-works" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.how}</a>
        </div>
        <p data-creator-availability className="mt-5 max-w-md text-xs leading-relaxed text-black/65"><CreatorAvailabilityNotice copy={{ ready: t.ready, preparing: t.preparing, subscriptionReady: t.subscriptionReady, subscriptionPaused: t.subscriptionPaused }} oneTimeAvailable={storefrontOpen()} /></p>
        {evidence !== null && definition}
      </div>
      {featured && <article data-featured-template={featured.slug} data-media-host className={`relative min-w-0 w-full rounded-2xl border border-black/10 bg-[#0D0D0F] p-3.5 text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.28)] sm:p-4 ${portrait ? 'max-w-sm justify-self-center' : ''}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px]">
          <span className="inline-flex items-center gap-2 font-mono tracking-[0.12em] text-white/75 uppercase">
            <span className="size-2 rounded-full bg-[#ED1E1E]" aria-hidden="true" />
            {t.example} · {ratio.replace(/\s+/g, '')}
          </span>
          {featured.modelLabels.length > 0 && (
            <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] text-white/75">
              {featured.modelLabels.join(' · ')}
            </span>
          )}
        </div>
        <div className="overflow-hidden rounded-xl ring-1 ring-white/10">
          <CreatorPreview poster={featured.poster} video={featured.video} title={title!} href={templateHref(locale, featured.slug)} ratio={ratio} labels={{ play: t.playPreview, pause: t.pausePreview }} fallback={<TypographicPoster title={title!} slug={featured.slug} kicker={featured.modelLabels.join(' · ')} ratio={ratio} />} />
        </div>
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-1 pt-3 text-xs">
          <span className="font-medium text-white/90">{title}</span>
          <a href={templateHref(locale, featured.slug)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black transition-opacity hover:opacity-90">
            {title} ↗
          </a>
        </div>
      </article>}
    </div>
  </section>;
}

export function CreatorHowItWorks({ dict }: { dict: Dictionary }) {
  const t = dict.creatorJourney;
  const steps = [[t.step1Title,t.step1Body],[t.step2Title,t.step2Body],[t.step3Title,t.step3Body]];
  return <section id="how-it-works" data-section data-theme="light" data-creator-journey className="section scroll-mt-24 border-y border-hairline">
    <div className="audience-shell py-16 lg:py-24">
      <p className="audience-eyebrow">{t.how}</p>
      <h2 className="audience-heading mt-4 max-w-2xl">{t.stepsHeading}</h2>
      <ol className="mt-10 grid gap-8 md:grid-cols-3">{steps.map(([title,body],index) => <li key={title} className="border-t border-hairline pt-5"><span className="text-xs opacity-40">0{index+1}</span><h3 className="mt-4 text-xl font-semibold tracking-tight">{title}</h3><p className="mt-3 text-sm leading-relaxed opacity-65">{body}</p></li>)}</ol>
    </div>
  </section>;
}

export function CreatorCampaignDoor({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.creatorJourney;
  return <section data-section data-theme="dark" data-creator-campaign-door className="section">
    <div className="audience-shell flex flex-wrap items-end justify-between gap-8 py-16 lg:py-24">
      <div className="max-w-2xl"><p className="audience-eyebrow">{dict.nav.campaigns}</p><h2 className="audience-heading mt-4">{t.campaignHeading}</h2><p className="mt-5 text-sm leading-relaxed opacity-65">{t.campaignBody}</p></div>
      <a href={campaignsHref(locale)} className="inline-flex min-h-12 items-center rounded-full bg-white px-6 text-sm font-medium text-black">{t.campaignCta} ↗</a>
    </div>
  </section>;
}

export function BrandDoor({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return <aside data-brand-door className="audience-shell my-16 grid gap-6 border-t border-hairline pt-8 sm:grid-cols-[1fr_auto] sm:items-center"><div><h2 className="text-lg font-semibold">{dict.audience.brandDoor}</h2><p className="mt-2 max-w-xl text-sm opacity-60">{dict.audience.brandDoorBody}</p></div><a href={brandsHref(locale)} className="text-sm font-medium underline underline-offset-4">{dict.audience.brandDoorCta} ↗</a></aside>;
}
