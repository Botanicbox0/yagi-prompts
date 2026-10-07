import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BRAND_STORIES, brandStory } from '@/lib/campaigns/brand-stories';
import { brandStoryMetadata } from '@/lib/seo/brand-story-metadata';
import { JsonLd } from '@/lib/seo/json-ld';
import { brandCaseStudiesStructuredData } from '@/lib/seo/structured-data';
import { siteUrl } from '@/lib/seo/site-url';

export const revalidate = 3600;
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return brandStoryMetadata(isLocale(locale) ? locale : DEFAULT_LOCALE);
}

export default async function StoriesPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale), t = dict.brandLanding.stories;
  return <>
    <MarketingNav locale={locale} dict={dict} rest="/brands/stories" />
    <JsonLd id="customer-stories-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, path: `/${locale}/brands/stories`, cases: BRAND_STORIES.map(story => ({ id: story.slug, name: t.title, description: t.summary, path: `/${locale}/brands/stories/${story.slug}` })) })} />
    <main id="main" data-brand-stories className="bg-brand-night text-white">
      <section data-section data-theme="dark" className="section"><div className="audience-shell pb-20 pt-32 lg:pt-40">
        <p className="audience-eyebrow text-brand-blue-light">{t.eyebrow}</p>
        <h1 className="audience-title mt-6 whitespace-pre-line">{t.indexTitle}</h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-white/65">{t.indexBody}</p>
        <div className="mt-14 grid gap-6">{BRAND_STORIES.map(story => {
          const campaign = brandStory(story.slug)?.campaigns[0];
          if (!campaign) return null;
          return <a key={story.slug} data-story-card={story.slug} href={`/${locale}/brands/stories/${story.slug}`} className="group grid overflow-hidden rounded-3xl border border-white/15 bg-brand-ink md:grid-cols-2">
            <div className="aspect-[4/3] overflow-hidden"><img src={campaign.media[0].poster} alt="" width={720} height={1280} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105" /></div>
            <div className="flex flex-col justify-center p-8 lg:p-12"><h2 className="audience-heading whitespace-pre-line">{t.title}</h2><p className="mt-6 max-w-lg text-sm leading-relaxed text-white/65">{t.summary}</p><span className="mt-8 inline-flex min-h-11 items-center gap-6 text-sm text-brand-blue-light">{t.detailCta} ↗</span></div>
          </a>;
        })}</div>
        <a href={`/${locale}/brands`} className="mt-10 inline-flex min-h-11 items-center text-sm underline underline-offset-6">← {t.back}</a>
      </div></section>
    </main><MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
