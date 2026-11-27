import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatPostDate, interpolate } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { CreativeAvatar } from '@/components/makers/identity';
import { makerHref } from '@/lib/makers/links';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { cardRatio } from '@/components/prompts/card-frame';
import { promptLabels } from '@/components/prompts/labels';
import type { PromptCard } from '@/lib/prompts/catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';
import { makerBlogOpen } from '@/lib/posts/flag';
import { cachedPublicPost, cachedPublicPostsByHandle } from '@/lib/posts/cached-public';
import {
  makerBlogListHref,
  makerBlogPostHref,
  makerBlogPostRest,
  postAccessEndpoint,
} from '@/lib/posts/links';
import { extractTemplateSlugs, headingAnchorId } from '@/lib/posts/schema';
import { postDetailMetadata, postStructuredData } from '@/lib/posts/seo';
import { PostAccessProvider } from '@/components/posts/post-access-context';
import { PostArticleShell } from '@/components/posts/post-article-shell';
import { PostBlocks } from '@/components/posts/post-blocks';

/**
 * `/[locale]/makers/[handle]/blog/[slug]` — public maker blog post (Batch 3).
 *
 * Security boundary: rendered HTML is static/cached without viewer headers and never contains
 * private prompt bodies (`meta`, `prompt`, `note` stay null in `public.ts`). Signed-in members
 * unlock prompt blocks client-side through `/api/posts/access`.
 */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string; handle: string; slug: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  if (!makerBlogOpen()) notFound();
  const { locale: rawLocale, handle, slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const post = await cachedPublicPost(handle, slug);
  if (!post) notFound();

  const dict = getDictionary(locale);
  const description =
    post.summary ?? interpolate(dict.makerBlog.listDescription, { handle: post.author.handle });
  const poster = post.cover?.kind === 'image' ? post.cover.src : post.author.avatar;

  return postDetailMetadata({
    handle: post.author.handle,
    slug: post.slug,
    locale,
    title: post.title,
    description,
    siteName: dict.meta.siteName,
    poster,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  });
}

export default async function MakerBlogPostPage({ params }: RouteParams) {
  if (!makerBlogOpen()) notFound();
  const { locale: rawLocale, handle, slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const post = await cachedPublicPost(handle, slug);
  if (!post) notFound();

  const dict = getDictionary(locale);
  const t = dict.makerBlog;
  const labels = promptLabels(dict);
  const referencedSlugs = new Set(extractTemplateSlugs(post.blocks));

  const [catalog, authorPosts] = await Promise.all([
    getPromptCatalog(),
    cachedPublicPostsByHandle(post.author.handle),
  ]);

  const allCards = [...catalog.video, ...catalog.image];
  const templatesBySlug = new Map<string, PromptCard>();
  for (const card of allCards) {
    if (referencedSlugs.has(card.slug)) {
      templatesBySlug.set(card.slug, card);
    }
  }

  let headingNumber = 0;
  const headings = post.blocks.flatMap((block) => {
    if (block.type !== 'heading') return [];
    headingNumber += 1;
    return [
      {
        id: headingAnchorId(headingNumber),
        n: headingNumber,
        title: block.text,
      },
    ];
  });

  const hasPromptBlocks = post.blocks.some((block) => block.type === 'prompt');
  const accessEndpoint = hasPromptBlocks
    ? postAccessEndpoint(post.author.handle, post.slug)
    : null;
  const postUrl = makerBlogPostHref(locale, post.author.handle, post.slug);
  const signin = signInHref(postUrl, locale);
  const authorTemplates = allCards
    .filter((card) => card.makerProfile && card.authorHandle === post.author.handle)
    .slice(0, 4);
  const otherPosts = authorPosts.filter((item) => item.slug !== post.slug).slice(0, 4);
  const dateText = formatPostDate(post.publishedAt ?? post.updatedAt, locale);
  const authorName = post.author.displayName ?? `@${post.author.handle}`;
  const description = post.summary ?? interpolate(t.listDescription, { handle: post.author.handle });

  return (
    <PersonalIdentity>
      <MarketingNav
        locale={locale}
        dict={dict}
        rest={makerBlogPostRest(post.author.handle, post.slug)}
        initialTheme="light"
      />
      <JsonLd
        id="maker-blog-structured-data"
        data={postStructuredData({
          origin: siteUrl(),
          locale,
          post,
          fallbackDescription: description,
          fallbackImage: post.author.avatar,
        })}
      />
      <main
        id="main"
        data-maker-blog-post={`${post.author.handle}/${post.slug}`}
        data-section
        data-theme="light"
        className="section pb-24 pt-28 lg:pt-36"
      >
        <article className="mx-auto max-w-shell px-gutter">
          <div className="sm:px-8 lg:px-10">
            <a
              href={makerBlogListHref(locale, post.author.handle)}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[#52525B] transition-colors hover:text-[#09090B]"
            >
              <span aria-hidden="true">←</span>
              <span>{t.backToBlog}</span>
            </a>

            <header className="mt-6 max-w-detail">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-[#71717A]">
                {dateText ? <span className="tabular-nums">{dateText}</span> : null}
                {dateText ? <span aria-hidden="true">·</span> : null}
                <span className="tabular-nums">{interpolate(t.readTime, { minutes: post.readingMinutes })}</span>
                <span aria-hidden="true">·</span>
                <a
                  href={makerHref(locale, post.author.handle)}
                  className="inline-flex items-center gap-2 font-medium text-[#09090B] hover:underline"
                >
                  <CreativeAvatar
                    handle={post.author.handle}
                    name={post.author.displayName}
                    src={post.author.avatar}
                    size={22}
                    eager
                  />
                  <span>{authorName}</span>
                </a>
              </div>

              <h1 className="mt-4 font-display text-[clamp(1.75rem,3.4vw,2.75rem)] leading-[1.15] font-bold tracking-[-0.03em] text-balance break-keep text-[#09090B]">
                {post.title}
              </h1>

              {post.summary ? (
                <p className="mt-4 break-keep text-base leading-[1.6] text-[#52525B]">{post.summary}</p>
              ) : null}
            </header>

            {post.cover ? (
              <figure className="mt-8 overflow-hidden rounded-[20px] bg-[#F4F4F5]">
                {post.cover.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- gateway-served creative work
                  <img
                    src={post.cover.src}
                    alt={post.title}
                    width={post.cover.width ?? undefined}
                    height={post.cover.height ?? undefined}
                    loading="eager"
                    decoding="async"
                    className="max-h-[44rem] w-full object-contain"
                  />
                ) : (
                  <video
                    src={`${post.cover.src}#t=0.1`}
                    controls
                    preload="metadata"
                    playsInline
                    className="max-h-[44rem] w-full bg-[#09090B]"
                  />
                )}
              </figure>
            ) : null}

            <div className={headings.length >= 3 ? '' : 'max-w-detail'}>
              <PostAccessProvider accessEndpoint={accessEndpoint}>
                <PostArticleShell headings={headings} tocLabel={t.tocLabel}>
                  <PostBlocks
                    blocks={post.blocks}
                    works={post.works}
                    templatesBySlug={templatesBySlug}
                    locale={locale}
                    promptLabels={labels}
                    blogCopy={t}
                    recipeCopy={dict.makerRecipe}
                    signinHref={signin}
                  />
                </PostArticleShell>
              </PostAccessProvider>
            </div>

            {authorTemplates.length > 0 ? (
              <section
                data-maker-blog-author-templates
                className="mt-16 border-t border-[#09090B]/[0.08] pt-10"
              >
                <h2 className="font-display text-xl font-bold tracking-[-0.025em] break-keep text-[#09090B]">
                  {interpolate(t.authorTemplatesHeading, { handle: post.author.handle })}
                </h2>
                <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {authorTemplates.map((card) => (
                    <li key={card.id}>
                      <div style={{ '--r': cardRatio(card) } as CSSProperties}>
                        <PromptCardView card={card} locale={locale} labels={labels} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {otherPosts.length > 0 ? (
              <section
                data-maker-blog-more-posts
                className="mt-16 border-t border-[#09090B]/[0.08] pt-10"
              >
                <h2 className="font-display text-xl font-bold tracking-[-0.025em] break-keep text-[#09090B]">
                  {interpolate(t.morePostsHeading, { handle: post.author.handle })}
                </h2>
                <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                  {otherPosts.map((other) => {
                    const otherDate = formatPostDate(other.publishedAt ?? other.updatedAt, locale);
                    return (
                      <li key={other.slug}>
                        <a
                          href={makerBlogPostHref(locale, post.author.handle, other.slug)}
                          className="group flex h-full flex-col justify-between rounded-[16px] border border-[#09090B]/[0.08] bg-white p-5 transition-colors hover:border-[#09090B]/[0.2]"
                        >
                          <div>
                            <h3 className="line-clamp-2 break-keep text-base font-semibold leading-[1.35] tracking-[-0.02em] text-[#09090B] group-hover:underline">
                              {other.title}
                            </h3>
                            {other.summary ? (
                              <p className="mt-1.5 line-clamp-2 break-keep text-sm text-[#52525B]">
                                {other.summary}
                              </p>
                            ) : null}
                          </div>
                          <p className="mt-4 flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-[#71717A]">
                            {otherDate ? <span>{otherDate}</span> : null}
                            {otherDate ? <span aria-hidden="true">·</span> : null}
                            <span>{interpolate(t.readTime, { minutes: other.readingMinutes })}</span>
                          </p>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        </article>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
