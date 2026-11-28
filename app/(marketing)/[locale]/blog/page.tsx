import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CreativeAvatar } from '@/components/makers/identity';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { FeaturedFeedCard, FeedPostCard } from '@/components/posts/post-cards';
import { isLocale, localizedPath, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { sortDirectoryMakers } from '@/lib/makers/directory';
import { makerHref, makersDirectoryHref } from '@/lib/makers/links';
import { cachedPublicBlogFeed, cachedPublicPostCountsByHandle } from '@/lib/posts/cached-public';
import { makerBlogOpen } from '@/lib/posts/flag';
import { BLOG_FEED_REST } from '@/lib/posts/links';
import { splitFeaturedFeedPost } from '@/lib/posts/public';
import { blogFeedMetadata, blogFeedStructuredData } from '@/lib/posts/seo';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';

export const revalidate = 3600;

type Params = { locale: string };

const FEATURED_MAKERS_MAX = 8;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale: raw } = await params;
  if (!makerBlogOpen() || !isLocale(raw)) notFound();
  const locale: Locale = raw;
  const dict = getDictionary(locale);
  const posts = await cachedPublicBlogFeed();
  const { featured } = splitFeaturedFeedPost(posts);
  const poster =
    featured?.cover?.kind === 'image'
      ? featured.cover.src
      : posts.find((post) => post.cover?.kind === 'image')?.cover?.src ?? null;

  return blogFeedMetadata({
    locale,
    title: dict.makerBlog.feedMetaTitle,
    description: dict.makerBlog.feedMetaDescription,
    siteName: dict.meta.siteName,
    poster,
  });
}

export default async function BlogFeedPage({ params }: { params: Promise<Params> }) {
  const { locale: raw } = await params;
  if (!makerBlogOpen() || !isLocale(raw)) notFound();
  const locale: Locale = raw;
  const dict = getDictionary(locale);
  const t = dict.makerBlog;

  const [posts, catalog, postCounts] = await Promise.all([
    cachedPublicBlogFeed(),
    getPromptCatalog(),
    cachedPublicPostCountsByHandle(),
  ]);

  const { featured, grid } = splitFeaturedFeedPost(posts);
  const directoryMakers = sortDirectoryMakers(catalog.makers, postCounts).slice(
    0,
    FEATURED_MAKERS_MAX,
  );
  const directHref = localizedPath(locale, '/direct');
  const structured = blogFeedStructuredData({
    origin: siteUrl(),
    locale,
    title: t.feedMetaTitle,
    description: t.feedMetaDescription,
    posts,
  });

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest={BLOG_FEED_REST} initialTheme="light" />
      <JsonLd id="blog-feed-structured-data" data={structured} />
      <main id="main" data-blog-feed data-section data-theme="light" className="section">
        <div className="audience-shell pt-24 pb-20 lg:pt-28">
          <header className="max-w-detail">
            <h1 className="audience-title break-keep text-[#09090B]">
              {t.feedHeading}
            </h1>
            <p className="mt-4 text-sm leading-relaxed break-keep text-[#52525B] sm:text-base">
              {t.feedLede}
            </p>
          </header>

            {posts.length === 0 ? (
              <div
                data-blog-feed-empty
                className="mt-10 border-t border-[#09090B]/[0.08] pt-8"
              >
                <p className="text-sm break-keep text-[#52525B]">{t.feedEmpty}</p>
                <p
                  data-blog-feed-writer
                  className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm break-keep text-[#52525B]"
                >
                  <span>{t.feedWriterLine}</span>
                  <a
                    href={directHref}
                    data-blog-feed-writer-link
                    className="inline-flex min-h-11 items-center font-medium text-[#CC1573] transition-colors hover:underline"
                  >
                    {t.feedWriterCta} →
                  </a>
                </p>
              </div>
            ) : (
              <>
                {featured ? (
                  <div className="mt-10">
                    <FeaturedFeedCard post={featured} locale={locale} readTimeTemplate={t.readTime} />
                  </div>
                ) : null}

                {grid.length > 0 ? (
                  <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {grid.map((post) => (
                      <FeedPostCard
                        key={`${post.author.handle}:${post.slug}`}
                        post={post}
                        locale={locale}
                        readTimeTemplate={t.readTime}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}

            {directoryMakers.length > 0 ? (
              <section data-blog-feed-makers className="mt-16 border-t border-[#09090B]/[0.08] pt-10">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-[#09090B] sm:text-2xl">
                    {t.feedMakersHeading}
                  </h2>
                  <a
                    href={makersDirectoryHref(locale)}
                    className="text-sm font-medium text-[#CC1573] transition-colors hover:underline"
                  >
                    {t.feedMakersViewAll}
                  </a>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {directoryMakers.map((maker) => {
                    const name = maker.displayName?.trim() || `@${maker.handle}`;
                    const count = postCounts[maker.handle] ?? 0;
                    const countText =
                      maker.templateCount > 0
                        ? interpolate(dict.makers.templateCount, { count: maker.templateCount })
                        : count > 0
                          ? interpolate(dict.makers.postCount, { count })
                          : null;

                    return (
                      <a
                        key={maker.handle}
                        href={makerHref(locale, maker.handle)}
                        data-blog-feed-maker={maker.handle}
                        className="flex items-center gap-3 rounded-[16px] border border-[#09090B]/[0.08] bg-[#FFFFFF] p-4 transition-[border-color] duration-200 hover:border-[#09090B]/20"
                      >
                        <CreativeAvatar
                          handle={maker.handle}
                          name={maker.displayName}
                          src={maker.avatar}
                          size={40}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#09090B]">{name}</p>
                          <p className="truncate text-xs text-[#71717A]">
                            @{maker.handle}
                            {countText ? ` · ${countText}` : ''}
                          </p>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {posts.length > 0 ? (
              <section
                data-blog-feed-writer
                className="mt-12 border-t border-[#09090B]/[0.08] pt-6 text-sm"
              >
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 break-keep text-[#52525B]">
                  <span>{t.feedWriterLine}</span>
                  <a
                    href={directHref}
                    data-blog-feed-writer-link
                    className="inline-flex min-h-11 items-center font-medium text-[#CC1573] transition-colors hover:underline"
                  >
                    {t.feedWriterCta} →
                  </a>
                </p>
              </section>
            ) : null}
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
