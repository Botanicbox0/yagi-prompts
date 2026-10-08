import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingNav, MarketingFooter } from '@/components/marketing/chrome';
import { BrandCustomerStory } from '@/components/campaigns/brand-customer-story';
import { BRAND_STORIES, brandStory } from '@/lib/campaigns/brand-stories';
import { brandStoryMetadata } from '@/lib/seo/brand-story-metadata';
import { JsonLd } from '@/lib/seo/json-ld';
import { brandCaseStudiesStructuredData } from '@/lib/seo/structured-data';
import { siteUrl } from '@/lib/seo/site-url';

export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() { return BRAND_STORIES.map(story => ({ slug: story.slug })); }
type Props = { params: Promise<{ locale: string; slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  if (!brandStory(slug)) notFound();
  return brandStoryMetadata(isLocale(locale) ? locale : DEFAULT_LOCALE, slug);
}
export default async function StoryPage({ params }: Props) {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const story = brandStory(slug);
  if (!story) notFound();
  const dict = getDictionary(locale), t = dict.brandLanding.stories;
  const path = `/${locale}/brands/stories/${story.slug}`;
  return <>
    <MarketingNav locale={locale} dict={dict} rest={`/brands/stories/${story.slug}`} />
    <JsonLd id="customer-story-structured-data" data={brandCaseStudiesStructuredData({ origin: siteUrl(), locale, path, cases: story.campaigns.map(campaign => ({ id: campaign.id, name: dict.brandLanding.cases[campaign.copyKey].eyebrow, description: dict.brandLanding.cases[campaign.copyKey].body })) })} />
    <main id="main" data-brand-story={story.slug} className="bg-brand-night text-white">
      <section data-section data-theme="dark" className="section"><div className="audience-shell pb-20 pt-28 lg:pt-36">
        <a href={`/${locale}/brands/stories`} className="inline-flex min-h-11 items-center text-sm text-brand-blue-light">← {t.allCta}</a>
        <h1 className="audience-title mt-6 whitespace-pre-line">{t.title}</h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/65">{t.summary}</p>
        <div className="mt-14"><BrandCustomerStory dict={dict} locale={locale} detail /></div>
        <a href={`/${locale}/brands#brands`} className="mt-12 inline-flex min-h-12 items-center gap-7 rounded-full bg-blue px-6 text-sm font-semibold">{dict.brandLanding.primaryCta} ↗</a>
      </div></section>
    </main><MarketingFooter locale={locale} dict={dict} audience="brand" />
  </>;
}
