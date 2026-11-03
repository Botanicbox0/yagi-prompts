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
  return <section data-section data-theme="light" data-creator-hero data-hero-has-evidence={evidence === null ? undefined : ''} className="section relative isolate">
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
      {featured && <article data-featured-template={featured.slug} data-media-host className={`relative min-w-0 w-full ${portrait ? 'max-w-sm justify-self-center' : ''}`}>
        <CreatorPreview poster={featured.poster} video={featured.video} title={title!} href={templateHref(locale, featured.slug)} ratio={ratio} labels={{ play: t.playPreview, pause: t.pausePreview }} fallback={<TypographicPoster title={title!} slug={featured.slug} kicker="" ratio={ratio} />} />
        <a href={templateHref(locale, featured.slug)} className="mt-3 flex items-baseline justify-between gap-3 text-sm font-medium tracking-[-0.01em]">
          <span>{title}</span>
          <span aria-hidden="true" className="text-muted">↗</span>
        </a>
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
      {/* Step numbers are spec labels, the one place mono belongs (docs/design/IDENTITY.md §3). */}
      <ol className="mt-10 grid gap-8 md:grid-cols-3">{steps.map(([title,body],index) => <li key={title} className="border-t border-hairline pt-5"><span className="font-mono text-xs tabular-nums text-muted">0{index+1}</span><h3 className="audience-subheading mt-4 text-xl">{title}</h3><p className="mt-3 text-sm leading-relaxed opacity-65">{body}</p></li>)}</ol>
    </div>
  </section>;
}

/** A white card on the canvas, like the brand side's blocks; the page keeps one blue button, so the door is quiet. */
export function CreatorCampaignDoor({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.creatorJourney;
  return <section data-section data-theme="light" data-creator-campaign-door className="section">
    <div className="audience-shell py-12 lg:py-16">
      <div className="flex flex-wrap items-end justify-between gap-8 rounded-3xl border border-hairline bg-white p-8 lg:p-12">
        <div className="max-w-2xl"><p className="audience-eyebrow">{dict.nav.campaigns}</p><h2 className="audience-heading mt-4">{t.campaignHeading}</h2><p className="mt-5 text-sm leading-relaxed opacity-65">{t.campaignBody}</p></div>
        <a href={campaignsHref(locale)} className="audience-button-quiet">{t.campaignCta} ↗</a>
      </div>
    </div>
  </section>;
}

export function BrandDoor({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return <aside data-brand-door className="audience-shell my-16 grid gap-6 border-t border-hairline pt-8 sm:grid-cols-[1fr_auto] sm:items-center"><div><h2 className="audience-subheading text-lg">{dict.audience.brandDoor}</h2><p className="mt-2 max-w-xl text-sm opacity-60">{dict.audience.brandDoorBody}</p></div><a href={brandsHref(locale)} className="text-sm font-medium underline underline-offset-4">{dict.audience.brandDoorCta} ↗</a></aside>;
}
