import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShapedPrompt, type PromptDetailResult } from '@/lib/prompts/facade';
import { USE_CASES } from '@/lib/prompts/schemas';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { promptMetadata, unresolvedPromptMetadata } from '@/lib/seo/prompt-metadata';
import { signInHref } from '@/lib/billing/links';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import {
  PromptBody,
  PromptHeader,
  RelatedPrompts,
  SubmitStrip,
} from '@/components/prompts/detail';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { isCookiePackPurchasable } from '@/lib/cookies/purchase';
import { unlockPromptAction } from './actions';
import { purchaseCookiePackAction } from './purchase-action';

/**
 * `/[locale]/prompts/[slug]` — PLAN §13.2, shaped per viewer.
 *
 * `force-dynamic` + `private, no-store` (middleware) for the same reason the playbook detail page
 * is: this is the one prompts route whose HTML differs by tier, and a shared cache holding one
 * reader's unlocked render is exactly the leak §3.4's cache contract exists to prevent.
 *
 * 404 for pending / rejected / archived, for everyone including admins (§13 moderation happens in
 * `/admin/prompts`, which reads those rows directly). The gate itself lives in
 * `lib/prompts/access.ts` — nothing here decides anything.
 */
export const dynamic = 'force-dynamic';

/** One resolution per request, shared by `generateMetadata` and the render. */
const resolve = cache((slug: string): Promise<PromptDetailResult> => getShapedPrompt(slug));

interface RouteParams {
  params: Promise<{ locale: string; slug: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const result = await resolve(slug);
  if (result.status !== 'ok') return unresolvedPromptMetadata(dict.meta.siteName);

  const { prompt } = result;
  return promptMetadata({
    slug: prompt.slug,
    locale,
    title: prompt.title,
    titleKo: prompt.titleKo,
    description: dict.meta.promptsDescription,
    poster: prompt.poster,
    video: prompt.video,
    siteName: dict.meta.siteName,
  });
}

export default async function PromptDetailPage({ params }: RouteParams) {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const result = await resolve(slug);
  if (result.status !== 'ok') notFound();

  const { prompt, related, unlockPanel } = result;
  const labels = promptLabels(dict);
  const ads = adLabels(dict);
  const useCaseLabels = Object.fromEntries(
    USE_CASES.map((value) => [value, useCaseLabel(dict, value)]),
  );

  // §15.3 — which lock-panel variant renders was decided next to the gate (unlockPanel); the page
  // only has to say where sign-in returns to: this prompt.
  const signin = signInHref(`/${locale}/prompts/${slug}`, locale);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/prompts/${slug}`} initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section pb-24">
        <div id="prompt-rail-anchor" className="relative">
          <AdRail anchorId="prompt-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band pt-28 lg:pt-32">
            <PromptHeader prompt={prompt} labels={labels} useCaseLabels={useCaseLabels} />

            <PromptBody
              prompt={prompt}
              locale={locale}
              labels={labels}
              panel={unlockPanel}
              signinHref={signin}
              unlockAction={unlockPromptAction}
              packReady={isCookiePackPurchasable()}
              packAction={purchaseCookiePackAction}
            />

            <RelatedPrompts
              cards={related}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
              signinHref={signin}
            />

            <SubmitStrip
              title={dict.prompts.submitStripTitle}
              body={dict.prompts.submitStripBody}
              cta={dict.prompts.submitCta}
            />

            <div className="mt-16 rail:hidden">
              <AdBanner labels={ads} />
            </div>
          </div>
        </div>
      </main>

      {/* §3.3 — the hire strip is the same one every content page ends on. */}
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
