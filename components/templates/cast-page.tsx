import { notFound } from 'next/navigation';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { coupleTemplatesOpen, petTemplatesOpen, templateLookOpen } from '@/lib/flags';
import { castShelf, castShelfSize, type CastSection } from '@/lib/prompts/catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { castRest } from '@/lib/prompts/links';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';
import { castCollectionStructuredData } from '@/lib/seo/structured-data';
import { FaqSection } from '@/lib/seo/faq-section';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { CastShelfSection } from './cast-shelf';
import { TemplateLookIsland } from '@/components/template-look/look-island';

/**
 * docs/CAST-CATEGORIES.md §5 — `/{locale}/pet` and `/{locale}/couple`, one page body. Static + tag
 * `prompts` like `/video`. 404 when the cast has no published template (no empty page in production)
 * and, for couples, whenever `TWINGS_COUPLE_TEMPLATES` is off.
 */
export async function CastPage({ locale, cast }: { locale: Locale; cast: CastSection }) {
  if (cast === 'couple' ? !coupleTemplatesOpen() : !petTemplatesOpen()) notFound();
  const dict = getDictionary(locale);
  const catalog = await getPromptCatalog();
  const shelf = castShelf(catalog, cast);
  if (castShelfSize(shelf) === 0) notFound();
  const copy = dict.cast[cast];
  const rest = castRest(cast);

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest={rest} initialTheme="light" />
      <JsonLd
        id={`cast-${cast}-structured-data`}
        data={castCollectionStructuredData({
          origin: siteUrl(), locale, path: `/${locale}${rest}`, name: copy.metaTitle, description: copy.metaDescription,
          cards: [...shelf.video, ...shelf.image],
        })}
      />
      <main id="main" data-cast-page={cast} data-section data-theme="light" className="section">
        <div className="audience-shell pt-24 pb-20 lg:pt-28">
          <CastShelfSection locale={locale} dict={dict} cast={cast} shelf={shelf} mode="page" />
          {/* The GEO definition (AGENTS.md §7), under the cards like the medium tabs. */}
          <p data-service-definition className="mt-16 max-w-2xl border-t border-hairline pt-6 text-sm leading-relaxed text-black/60">{copy.definition}</p>
          {/* docs/PERSONAL-STUDIO.md §3.4.10 — the template style, only with the switch on. */}
          {templateLookOpen() && <TemplateLookIsland copy={dict.templateLook} />}
        </div>
      </main>
      <FaqSection dict={dict} locale={locale} placement="template" path={`/${locale}${rest}`} />
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
