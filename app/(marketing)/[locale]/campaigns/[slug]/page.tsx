import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate, localize } from '@/lib/i18n/format';
import { formatCampaignDateTime } from '@/lib/campaigns/dates';
import { getCampaignCatalog } from '@/lib/campaigns/public-catalog';
import { campaignApplyPath, campaignsHref } from '@/lib/campaigns/links';
import { acceptsApplications } from '@/lib/campaigns/state';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { promptHref, templateHref } from '@/lib/prompts/links';
import { RENDER_PIPELINE_PUBLIC } from '@/lib/flags';
import { campaignMetadata, unresolvedCampaignMetadata } from '@/lib/seo/campaign-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { Markdown } from '@/components/playbook/markdown';
import { TextSwap } from '@/components/ui/text-swap';
import { CampaignSteps } from '@/components/campaigns/rails';
import { campaignLabels } from '@/components/campaigns/labels';
import { FaqSection } from '@/lib/seo/faq-section';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';
import { campaignServiceStructuredData } from '@/lib/seo/structured-data';

/**
 * `/[locale]/campaigns/[slug]` — docs/CAMPAIGNS.md §6, the detail: brief, the format's example
 * film, the payout rule as a sentence, the posting requirements, the timeline, and one door —
 * "apply", which is the login-gated (app) route.
 *
 * Read from the cached projection rather than the database: a public campaign is public to
 * everyone identically, so the same document the listing was built from serves the detail, and
 * the same tag invalidates both. A draft or archived campaign is not in the projection → 404.
 */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string; slug: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function resolve(slug: string) {
  const [catalog, prompts] = await Promise.all([getCampaignCatalog(), getPromptCatalog()]);
  const campaign = catalog.campaigns.find((card) => card.slug === slug) ?? null;
  const style = campaign?.styleSlug
    ? ([...prompts.yagi, ...prompts.community].find((card) => card.slug === campaign.styleSlug) ?? null)
    : null;
  return { campaign, style };
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const { campaign, style } = await resolve(slug);
  if (campaign === null) return unresolvedCampaignMetadata(dict.meta.siteName);
  return campaignMetadata({ campaign, posterSrc: style?.poster?.src ?? null, locale, siteName: dict.meta.siteName });
}

export default async function CampaignDetailPage({ params }: RouteParams) {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const { campaign, style } = await resolve(slug);
  if (campaign === null) notFound();

  const c = dict.campaigns;
  const labels = campaignLabels(dict);
  const now = Date.now();
  const open = acceptsApplications(campaign, now);
  const slotsLeft = Math.max(0, campaign.slots - campaign.slotsTaken);
  const title = localize(campaign.title, locale);
  const summary = localize(campaign.summary, locale);
  const brief = campaign.brief ? localize(campaign.brief, locale) : '';
  const closeDate = formatCampaignDateTime(campaign.applicationsCloseAt, locale);
  const postDate = formatCampaignDateTime(campaign.postDeadlineAt, locale);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/campaigns/${slug}`} initialTheme="light" />
      <JsonLd id="campaign-service-structured-data" data={campaignServiceStructuredData({ origin: siteUrl(), path: `/${locale}/campaigns/${slug}`, locale, name: title, description: summary, serviceType: dict.seo.serviceType, offer: open })} />

      <main id="main" data-section data-theme="light" className="section">
        <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
          <a href={campaignsHref(locale)} className="font-mono text-[0.72rem] opacity-60">
            ← {c.eyebrow}
          </a>

          <div className="mt-6 flex flex-wrap items-center gap-2 font-label text-[0.72rem] tracking-[0.12em] uppercase">
            <span data-status-chip={campaign.status} className={open ? 'bg-accent px-2 py-1 text-white' : 'border border-hairline px-2 py-1 opacity-70'}>
              {labels.status[campaign.status]}
            </span>
            <span className="opacity-55">{labels.hostedBy}</span>
            <span>{campaign.hostName}</span>
            <span className="border border-hairline px-2 py-1 opacity-70">{labels.hostKind[campaign.hostKind]}</span>
          </div>

          <h1 className="mt-6 max-w-[18ch] font-display text-[clamp(2.2rem,5vw,4rem)] leading-[0.92] font-black whitespace-pre-line uppercase">
            {title}
          </h1>
          <p className="mt-6 max-w-detail text-body opacity-70">{summary}</p>

          <div data-campaign-facts className="mt-10 grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
            <div className="bg-surface p-5">
              <p className="font-label text-[0.68rem] tracking-[0.12em] uppercase opacity-50">{c.slotsLabel}</p>
              <p className="mt-2 font-display text-[1.6rem] leading-none font-black">
                {interpolate(labels.slotsLine, { left: String(slotsLeft), slots: String(campaign.slots) })}
              </p>
            </div>
            <div className="bg-surface p-5">
              <p className="font-label text-[0.68rem] tracking-[0.12em] uppercase opacity-50">{c.timelineHeading}</p>
              <p className="mt-2 font-mono text-[0.8rem]">{closeDate ? interpolate(labels.applyBy, { date: closeDate }) : '—'}</p>
              <p className="mt-1 font-mono text-[0.8rem] opacity-60">{postDate ? interpolate(labels.postBy, { date: postDate }) : '—'}</p>
            </div>
            <div className="bg-surface p-5">
              <p className="font-label text-[0.68rem] tracking-[0.12em] uppercase opacity-50">{c.reqPlatforms}</p>
              <p className="mt-2 font-mono text-[0.8rem]">
                {campaign.platforms.map((p) => labels.platform[p]).join(' · ')} · {labels.deliverable[campaign.deliverable]}
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
            {open && slotsLeft > 0 ? (
              <a
                href={campaignApplyPath(campaign.slug)}
                data-campaign-apply
                className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase"
              >
                <TextSwap>{labels.applyCta} →</TextSwap>
              </a>
            ) : (
              <span data-campaign-apply="closed" className="inline-block border border-hairline px-6 py-3 font-label text-label uppercase opacity-60">
                {slotsLeft === 0 && open ? c.slotsFullNotice : labels.applyClosed}
              </span>
            )}
          </div>

          {/* The format: the style's own example film, and the door into the studio. */}
          {style && (
            <section data-campaign-format className="mt-16 border-t border-hairline pt-10">
              <h2 className="font-display text-[clamp(1.4rem,2.6vw,2.1rem)] leading-[0.95] font-black uppercase">{c.formatHeading}</h2>
              {/* Q3: while personal generation is closed the page must not promise "upload and it comes out". */}
              <p className="mt-4 max-w-detail text-body opacity-70">{RENDER_PIPELINE_PUBLIC ? c.formatBody : c.formatBodyClosed}</p>
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
                <div className="aspect-video overflow-hidden border border-hairline bg-black">
                  {style.video ? (
                    <video
                      src={style.video.src}
                      {...(style.poster ? { poster: style.poster.src } : {})}
                      controls
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-contain"
                    />
                  ) : style.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public bucket object
                    <img src={style.poster.src} alt={localize({ en: style.title, ko: style.titleKo ?? style.title }, locale)} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div>
                  <p className="font-label text-[0.7rem] tracking-[0.12em] uppercase opacity-50">{c.seeStyle}</p>
                  <p className="mt-2 font-display text-[1.3rem] leading-[1] font-black uppercase">
                    {locale === 'ko' && style.titleKo ? style.titleKo : style.title}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
                    {/* Audit P2-11: straight to this template's make section — `/{locale}/studio` 308'd
                        to the generic listing and dropped the template. */}
                    <a href={`${templateHref(locale, style.slug)}#make`} data-campaign-make className="text-accent font-label text-label uppercase">
                      <TextSwap>{RENDER_PIPELINE_PUBLIC ? c.makeItCta : c.makeItCtaClosed} →</TextSwap>
                    </a>
                    <a href={promptHref(locale, style.slug)} className="font-label text-label uppercase opacity-70">
                      <TextSwap>{dict.studio.seePrompt} →</TextSwap>
                    </a>
                  </div>
                </div>
              </div>
            </section>
          )}

          {brief && (
            <section data-campaign-brief className="mt-16 border-t border-hairline pt-10">
              <h2 className="font-display text-[clamp(1.4rem,2.6vw,2.1rem)] leading-[0.95] font-black uppercase">{c.briefHeading}</h2>
              <article className="mt-6 max-w-detail">
                <Markdown source={brief} />
              </article>
            </section>
          )}

          <section data-campaign-requirements className="mt-16 border-t border-hairline pt-10">
            <h2 className="font-display text-[clamp(1.4rem,2.6vw,2.1rem)] leading-[0.95] font-black uppercase">{c.requirementsHeading}</h2>
            <dl className="mt-6 grid max-w-detail gap-x-8 gap-y-3 font-mono text-[0.8rem] sm:grid-cols-[auto_1fr]">
              {campaign.requirements.disclosure && (
                <>
                  <dt className="opacity-50">{c.reqDisclosureLabel}</dt>
                  <dd className="text-accent">{c.reqDisclosure}</dd>
                </>
              )}
              {campaign.requirements.hashtags.length > 0 && (
                <>
                  <dt className="opacity-50">{c.reqHashtags}</dt>
                  <dd>{campaign.requirements.hashtags.map((tag) => `#${tag}`).join(' ')}</dd>
                </>
              )}
              {campaign.requirements.mentions.length > 0 && (
                <>
                  <dt className="opacity-50">{c.reqMentions}</dt>
                  <dd>{campaign.requirements.mentions.map((m) => `@${m}`).join(' ')}</dd>
                </>
              )}
              <dt className="opacity-50">{c.reqPlatforms}</dt>
              <dd>{campaign.platforms.map((p) => labels.platform[p]).join(', ')}</dd>
            </dl>
          </section>

          <CampaignSteps heading={c.stepsHeading} steps={[c.step1, c.step2, c.step3, c.step4, c.step5]} />
        </div>
      </main>
      <FaqSection dict={dict} locale={locale} placement="campaign" path={`/${locale}/campaigns/${slug}`} />
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
