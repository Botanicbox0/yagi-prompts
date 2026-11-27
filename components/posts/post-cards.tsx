import { CreativeAvatar } from '@/components/makers/identity';
import { makerHref } from '@/lib/makers/links';
import type { Locale } from '@/lib/i18n/config';
import { formatPostDate, interpolate } from '@/lib/i18n/format';
import { makerBlogPostHref } from '@/lib/posts/links';
import type { PublicFeedPost, PublicPostMedia, PublicPostSummary } from '@/lib/posts/public';

const COVER_FALLBACK_WASH = [
  'radial-gradient(120% 160% at 10% 0%, color-mix(in oklab, var(--accent) 14%, #F4F4F5) 0%, transparent 64%)',
  'linear-gradient(135deg, #F4F4F5, #E4E4E7)',
].join(', ');

function PostCoverFrame({
  cover,
  alt,
  eager = false,
}: {
  cover: PublicPostMedia | null;
  alt: string;
  eager?: boolean;
}) {
  if (!cover) {
    return (
      <div
        aria-hidden="true"
        className="h-full w-full"
        style={{ background: COVER_FALLBACK_WASH }}
      />
    );
  }
  if (cover.kind === 'video') {
    // Feed and grid cards stay still; playback runs inside the post page only.
    return (
      <video
        src={`${cover.src}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        aria-label={alt}
      />
    );
  }
  return (
    // Creative media stays unoptimized behind /creative-media so static routes do not proxy images.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cover.src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className="h-full w-full object-cover"
    />
  );
}

function postMetaLine(
  publishedAt: string | null,
  readingMinutes: number,
  locale: Locale,
  readTimeTemplate: string,
): string {
  const dateLabel = formatPostDate(publishedAt, locale);
  const readTimeLabel = interpolate(readTimeTemplate, { minutes: String(readingMinutes) });
  return dateLabel ? `${dateLabel} · ${readTimeLabel}` : readTimeLabel;
}

export function FeaturedFeedCard({
  post,
  locale,
  readTimeTemplate,
}: {
  post: PublicFeedPost;
  locale: Locale;
  readTimeTemplate: string;
}) {
  const href = makerBlogPostHref(locale, post.author.handle, post.slug);
  const authorHandle = `@${post.author.handle}`;
  const metaLine = postMetaLine(
    post.publishedAt ?? post.updatedAt,
    post.readingMinutes,
    locale,
    readTimeTemplate,
  );

  return (
    <article
      data-blog-feed-featured={post.slug}
      className="group relative overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-[#FFFFFF] transition-[border-color] duration-200 hover:border-[#09090B]/20"
    >
      <div className="grid gap-5 p-4 sm:gap-7 sm:p-6 md:grid-cols-12 md:items-center">
        <div className="aspect-video w-full overflow-hidden rounded-[12px] bg-[#F4F4F5] md:col-span-7">
          <PostCoverFrame cover={post.cover} alt={post.title} eager />
        </div>
        <div className="flex flex-col justify-between md:col-span-5">
          <div>
            <h2 className="font-display line-clamp-2 text-2xl font-semibold leading-[1.2] tracking-[-0.02em] break-keep text-[#09090B] sm:text-[28px]">
              <a
                href={href}
                className="after:absolute after:inset-0 focus-visible:outline-none"
              >
                {post.title}
              </a>
            </h2>
            {post.summary ? (
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed break-keep text-[#52525B]">
                {post.summary}
              </p>
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <a
              href={makerHref(locale, post.author.handle)}
              className="relative z-10 inline-flex items-center gap-2.5 text-sm font-medium text-[#09090B] transition-colors hover:text-[#CC1573]"
            >
              <CreativeAvatar
                handle={post.author.handle}
                name={post.author.displayName}
                src={post.author.avatar}
                size={28}
                eager
              />
              <span className="truncate">{authorHandle}</span>
            </a>
            <span className="shrink-0 tabular-nums text-xs text-[#71717A]">{metaLine}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function FeedPostCard({
  post,
  locale,
  readTimeTemplate,
}: {
  post: PublicFeedPost;
  locale: Locale;
  readTimeTemplate: string;
}) {
  const href = makerBlogPostHref(locale, post.author.handle, post.slug);
  const authorHandle = `@${post.author.handle}`;
  const metaLine = postMetaLine(
    post.publishedAt ?? post.updatedAt,
    post.readingMinutes,
    locale,
    readTimeTemplate,
  );

  return (
    <article
      data-blog-feed-card={post.slug}
      className="group relative flex flex-col overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-[#FFFFFF] p-4 transition-[border-color] duration-200 hover:border-[#09090B]/20"
    >
      <div className="aspect-video w-full overflow-hidden rounded-[12px] bg-[#F4F4F5]">
        <PostCoverFrame cover={post.cover} alt={post.title} />
      </div>
      <div className="mt-4 flex flex-1 flex-col">
        <h2 className="font-display line-clamp-2 text-lg font-semibold leading-snug tracking-[-0.015em] break-keep text-[#09090B]">
          <a
            href={href}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {post.title}
          </a>
        </h2>
        {post.summary ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed break-keep text-[#52525B]">
            {post.summary}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <a
            href={makerHref(locale, post.author.handle)}
            className="relative z-10 inline-flex min-w-0 items-center gap-2 text-xs font-medium text-[#09090B] transition-colors hover:text-[#CC1573]"
          >
            <CreativeAvatar
              handle={post.author.handle}
              name={post.author.displayName}
              src={post.author.avatar}
              size={24}
            />
            <span className="truncate">{authorHandle}</span>
          </a>
          <span className="shrink-0 tabular-nums text-xs text-[#71717A]">{metaLine}</span>
        </div>
      </div>
    </article>
  );
}

export function ProfilePostCard({
  post,
  handle,
  locale,
  readTimeTemplate,
}: {
  post: PublicPostSummary;
  handle: string;
  locale: Locale;
  readTimeTemplate: string;
}) {
  const href = makerBlogPostHref(locale, handle, post.slug);
  const metaLine = postMetaLine(
    post.publishedAt ?? post.updatedAt,
    post.readingMinutes,
    locale,
    readTimeTemplate,
  );

  return (
    <article
      data-maker-blog-card={post.slug}
      className="group relative flex flex-col overflow-hidden rounded-[16px] border border-[#09090B]/[0.08] bg-[#FFFFFF] p-4 transition-[border-color] duration-200 hover:border-[#09090B]/20"
    >
      <div className="aspect-video w-full overflow-hidden rounded-[12px] bg-[#F4F4F5]">
        <PostCoverFrame cover={post.cover} alt={post.title} />
      </div>
      <div className="mt-4 flex flex-1 flex-col">
        <h3 className="font-display line-clamp-2 text-lg font-semibold leading-snug tracking-[-0.015em] break-keep text-[#09090B]">
          <a
            href={href}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {post.title}
          </a>
        </h3>
        {post.summary ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed break-keep text-[#52525B]">
            {post.summary}
          </p>
        ) : null}
        <p className="mt-auto pt-4 tabular-nums text-xs text-[#71717A]">{metaLine}</p>
      </div>
    </article>
  );
}
