import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatPostDate, interpolate } from '@/lib/i18n/format';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { CreativeAvatar, placeOf } from '@/components/makers/identity';
import { cachedPublicWorks } from '@/lib/makers/cached-public';
import { makerHref } from '@/lib/makers/links';
import { makerBioFor, makerHandleOf } from '@/lib/makers/profile';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { makerBlogOpen } from '@/lib/posts/flag';
import { cachedPublicPostsByHandle } from '@/lib/posts/cached-public';
import { MakerBlogEmptyOwnerCta } from '@/components/makers/owner-actions';
import { makerBlogListRest, makerBlogPostHref, postEditorHref } from '@/lib/posts/links';
import { postListMetadata } from '@/lib/posts/seo';
import { ProfileTabs } from '@/components/posts/profile-tabs';

/**
 * `/[locale]/makers/[handle]/blog` — AI creative's public blog list (Batch 3).
 * Static + tag-revalidated (1h TTL), hidden (404) while `TWINGS_MAKER_BLOG` is off.
 */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string; handle: string }>;
}

async function findPublicMaker(rawHandle: string) {
  const handle = makerHandleOf(rawHandle);
  if (!handle) return null;
  const catalog = await getPromptCatalog();
  return (catalog.makers ?? []).find((item) => item.handle === handle) ?? null;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  if (!makerBlogOpen()) notFound();
  const { locale: rawLocale, handle } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const maker = await findPublicMaker(handle);
  if (!maker) notFound();

  const dict = getDictionary(locale);
  const t = dict.makerBlog;
  const posts = await cachedPublicPostsByHandle(maker.handle);
  const coverImage = posts.find((post) => post.cover?.kind === 'image')?.cover?.src ?? null;
  const title = maker.displayName
    ? interpolate(t.listTitleNamed, { name: maker.displayName })
    : interpolate(t.listTitle, { handle: maker.handle });

  return postListMetadata({
    handle: maker.handle,
    locale,
    title,
    description: interpolate(t.listDescription, { handle: maker.handle }),
    siteName: dict.meta.siteName,
    poster: coverImage ?? maker.cover ?? maker.avatar ?? null,
  });
}

export default async function MakerBlogListPage({ params }: RouteParams) {
  if (!makerBlogOpen()) notFound();
  const { locale: rawLocale, handle } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const maker = await findPublicMaker(handle);
  if (!maker) notFound();

  const [posts, works] = await Promise.all([
    cachedPublicPostsByHandle(maker.handle),
    cachedPublicWorks(maker.handle),
  ]);

  const dict = getDictionary(locale);
  const t = dict.makerBlog;
  const bio = makerBioFor(maker, locale);
  const place = placeOf(maker.country, maker.city, locale);
  const heading = maker.displayName
    ? interpolate(t.listTitleNamed, { name: maker.displayName })
    : interpolate(t.listTitle, { handle: maker.handle });

  return (
    <PersonalIdentity>
      <MarketingNav
        locale={locale}
        dict={dict}
        rest={makerBlogListRest(maker.handle)}
        initialTheme="light"
      />
      <main
        id="main"
        data-maker-blog-list={maker.handle}
        data-section
        data-theme="light"
        className="section pb-24 pt-28 lg:pt-36"
      >
        <div className="mx-auto max-w-shell px-gutter">
          <div className="sm:px-8 lg:px-10">
            <a
              href={makerHref(locale, maker.handle)}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[#52525B] transition-colors hover:text-[#09090B]"
            >
              <span aria-hidden="true">←</span>
              <span>{t.backToProfile}</span>
            </a>

            <header className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center">
              <CreativeAvatar handle={maker.handle} name={maker.displayName} src={maker.avatar} size={72} eager />
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#71717A]">
                  @{maker.handle}
                  {place ? ` · ${place}` : ''}
                </p>
                <h1 className="mt-1 font-display text-[clamp(1.6rem,3vw,2.35rem)] leading-[1.15] font-bold tracking-[-0.03em] break-keep text-[#09090B]">
                  {heading}
                </h1>
                {maker.headline ? (
                  <p className="mt-1.5 break-keep text-sm text-[#52525B]">{maker.headline}</p>
                ) : bio ? (
                  <p className="mt-1.5 max-w-detail break-keep text-sm text-[#52525B]">{bio}</p>
                ) : null}
              </div>
            </header>
          </div>

          <ProfileTabs
            locale={locale}
            handle={maker.handle}
            active="blog"
            hasWorks={works.length > 0}
            postCount={posts.length}
            labels={{
              templates: t.tabTemplates,
              blog: t.tabBlog,
              works: t.tabWorks,
            }}
          />

          <div className="mt-10 sm:px-8 lg:px-10">
            {posts.length === 0 ? (
              <div className="border-t border-[#09090B]/[0.08] pt-8">
                <p
                  data-maker-blog-empty
                  className="text-sm break-keep text-[#52525B]"
                >
                  {t.listEmpty}
                </p>
                <MakerBlogEmptyOwnerCta
                  handle={maker.handle}
                  writeHref={postEditorHref('new')}
                  label={t.firstPostCta}
                />
              </div>
            ) : (
              <ul className="grid gap-5 md:grid-cols-2">
                {posts.map((post) => {
                  const formattedDate = formatPostDate(post.publishedAt ?? post.updatedAt, locale);
                  return (
                    <li key={post.slug}>
                      <a
                        href={makerBlogPostHref(locale, maker.handle, post.slug)}
                        data-maker-blog-card={post.slug}
                        className="group flex h-full flex-col overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-white transition-colors hover:border-[#09090B]/[0.2]"
                      >
                        {post.cover ? (
                          <div className="aspect-[16/9] overflow-hidden bg-[#F4F4F5]">
                            {post.cover.kind === 'image' ? (
                              // eslint-disable-next-line @next/next/no-img-element -- gateway-served creative work
                              <img
                                src={post.cover.src}
                                alt={post.title}
                                width={post.cover.width ?? undefined}
                                height={post.cover.height ?? undefined}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.02]"
                              />
                            ) : (
                              <video
                                src={`${post.cover.src}#t=0.1`}
                                muted
                                playsInline
                                preload="metadata"
                                className="h-full w-full object-cover"
                              />
                            )}
                          </div>
                        ) : null}
                        <div className="flex flex-1 flex-col justify-between p-5 sm:p-6">
                          <div>
                            <h2 className="line-clamp-2 break-keep text-lg font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B] group-hover:underline">
                              {post.title}
                            </h2>
                            {post.summary ? (
                              <p className="mt-2 line-clamp-2 break-keep text-sm leading-relaxed text-[#52525B]">
                                {post.summary}
                              </p>
                            ) : null}
                          </div>
                          <p className="mt-4 flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-[#71717A]">
                            {formattedDate ? <span>{formattedDate}</span> : null}
                            {formattedDate ? <span aria-hidden="true">·</span> : null}
                            <span>{interpolate(t.readTime, { minutes: post.readingMinutes })}</span>
                          </p>
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
