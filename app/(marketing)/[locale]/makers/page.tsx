import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CreativeAvatar, MAKER_COVER_FALLBACK } from '@/components/makers/identity';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { sortDirectoryMakers } from '@/lib/makers/directory';
import { MAKER_REST, makerHref } from '@/lib/makers/links';
import { cachedPublicPostCountsByHandle } from '@/lib/posts/cached-public';
import { makerBlogOpen } from '@/lib/posts/flag';
import { makerBlogListHref } from '@/lib/posts/links';
import { makersDirectoryMetadata, makersDirectoryStructuredData } from '@/lib/posts/seo';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';

export const revalidate = 3600;

type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale: raw } = await params;
  if (!makerBlogOpen() || !isLocale(raw)) notFound();
  const locale: Locale = raw;
  const dict = getDictionary(locale);
  const t = dict.makers;
  const catalog = await getPromptCatalog();
  const poster =
    catalog.makers.find((maker) => maker.cover)?.cover ??
    catalog.makers.find((maker) => maker.avatar)?.avatar ??
    null;

  return makersDirectoryMetadata({
    locale,
    title: t.directoryMetaTitle,
    description: t.directoryMetaDescription,
    siteName: dict.meta.siteName,
    poster,
  });
}

export default async function MakersDirectoryPage({ params }: { params: Promise<Params> }) {
  const { locale: raw } = await params;
  if (!makerBlogOpen() || !isLocale(raw)) notFound();
  const locale: Locale = raw;
  const dict = getDictionary(locale);
  const t = dict.makers;

  const [catalog, postCounts] = await Promise.all([
    getPromptCatalog(),
    cachedPublicPostCountsByHandle(),
  ]);
  const makers = sortDirectoryMakers(catalog.makers, postCounts);
  const structured = makersDirectoryStructuredData({
    origin: siteUrl(),
    locale,
    title: t.directoryMetaTitle,
    description: t.directoryMetaDescription,
    makers,
  });

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest={MAKER_REST} initialTheme="light" />
      <JsonLd id="makers-directory-structured-data" data={structured} />
      <main id="main" data-makers-directory data-section data-theme="light" className="section">
        <div className="audience-shell pt-24 pb-20 lg:pt-28">
          <header className="max-w-detail">
            <h1 className="audience-title break-keep text-[#09090B]">
              {t.directoryHeading}
            </h1>
            <p className="mt-4 text-sm leading-relaxed break-keep text-[#52525B] sm:text-base">
              {t.directoryLede}
            </p>
          </header>

            {makers.length === 0 ? (
              <p
                data-makers-directory-empty
                className="mt-10 border-t border-[#09090B]/[0.08] pt-8 text-sm break-keep text-[#52525B]"
              >
                {t.directoryEmpty}
              </p>
            ) : (
              <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {makers.map((maker) => {
                  const displayName = maker.displayName?.trim() || `@${maker.handle}`;
                  const postCount = postCounts[maker.handle] ?? 0;

                  return (
                    <article
                      key={maker.handle}
                      data-maker-card={maker.handle}
                      className="group relative flex flex-col overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-[#FFFFFF] p-4 transition-[border-color] duration-200 hover:border-[#09090B]/20"
                    >
                      <div
                        className="aspect-[3/1] w-full overflow-hidden rounded-[12px]"
                        style={maker.cover ? undefined : { background: MAKER_COVER_FALLBACK }}
                      >
                        {maker.cover ? (
                          // eslint-disable-next-line @next/next/no-img-element -- gateway-served creative cover
                          <img
                            src={maker.cover}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>

                      <div className="mt-4 flex items-center gap-3">
                        <CreativeAvatar
                          handle={maker.handle}
                          name={maker.displayName}
                          src={maker.avatar}
                          size={44}
                        />
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate font-display text-base font-semibold leading-tight text-[#09090B]">
                            <a
                              href={makerHref(locale, maker.handle)}
                              className="after:absolute after:inset-0 focus-visible:outline-none"
                            >
                              {displayName}
                            </a>
                          </h2>
                          <p className="truncate text-xs text-[#71717A]">@{maker.handle}</p>
                        </div>
                      </div>

                      {maker.headline ? (
                        <p className="mt-3 line-clamp-1 text-sm break-keep text-[#52525B]">
                          {maker.headline}
                        </p>
                      ) : null}

                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                        <div className="flex flex-wrap items-center gap-3 tabular-nums text-xs text-[#71717A]">
                          {maker.templateCount > 0 ? (
                            <span>
                              {interpolate(t.templateCount, { count: maker.templateCount })}
                            </span>
                          ) : null}
                          {postCount > 0 ? (
                            <span>{interpolate(t.postCount, { count: postCount })}</span>
                          ) : null}
                        </div>
                        {postCount > 0 ? (
                          <a
                            href={makerBlogListHref(locale, maker.handle)}
                            className="relative z-10 text-xs font-medium text-[#CC1573] transition-colors hover:underline"
                          >
                            {t.directoryViewBlog}
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
