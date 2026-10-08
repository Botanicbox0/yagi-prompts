import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { brandsHref, campaignsHref } from '@/lib/campaigns/links';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
import { CreatorPreview } from './creator-preview';
import { TypographicPoster } from '@/components/prompts/poster';

export function CreatorHero({ dict, locale, featured }: { dict: Dictionary; locale: Locale; featured?: PromptCard }) {
  const t = dict.creatorJourney;
  const title = featured && (locale === 'ko' ? featured.titleKo || featured.title : featured.title);
  const measured = [featured?.video, featured?.poster].find(media => media?.w && media?.h && media.w > 0 && media.h > 0);
  // Generation's aspectDefault is not the uploaded example's framing. Unknown media keeps
  // the catalog's 16:9 preview window rather than inventing a portrait frame around a wide film.
  const ratio = measured ? `${measured.w} / ${measured.h}` : '16 / 9';
  const [ratioWidth, ratioHeight] = ratio.split('/').map(Number);
  const portrait = (ratioWidth ?? 16) < (ratioHeight ?? 9);
  return <section data-section data-theme="light" data-creator-hero className="section">
    <div className="audience-shell grid items-center gap-10 pt-28 pb-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:pt-36 lg:pb-20">
      <div>
        <p className="audience-eyebrow">{t.eyebrow}</p>
        <h1 className="audience-title mt-6 whitespace-pre-line">{t.title}</h1>
        <p data-service-definition className="mt-6 max-w-lg text-base leading-relaxed opacity-65">{t.body}</p>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <a href={templatesHref(locale, 'video')} data-hero-video className="audience-button">{t.browse} ↗</a>
          <a href="#how-it-works" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.how}</a>
        </div>
        <p data-creator-availability className="mt-5 max-w-md text-xs leading-relaxed opacity-55">{RENDER_PIPELINE_PUBLIC ? t.ready : t.preparing}</p>
      </div>
      {featured && <article data-featured-template={featured.slug} data-media-host className={`relative min-w-0 w-full ${portrait ? 'max-w-xs justify-self-center' : ''}`}>
        <CreatorPreview poster={featured.poster} video={featured.video} title={title!} href={templateHref(locale, featured.slug)} ratio={ratio} labels={{ play: t.playPreview, pause: t.pausePreview }} fallback={<TypographicPoster title={title!} slug={featured.slug} kicker={featured.modelLabels.join(' · ')} ratio={ratio} />} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="opacity-50">{t.example}</span>
          <a href={templateHref(locale, featured.slug)} className="font-medium">{title} ↗</a>
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
