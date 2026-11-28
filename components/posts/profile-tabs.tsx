import type { Locale } from '@/lib/i18n/config';
import { makerHref } from '@/lib/makers/links';
import { makerBlogListHref } from '@/lib/posts/links';

/**
 * Single horizontal tab strip on the maker profile and blog index (`템플릿 · 블로그 · 대표 작업`).
 * Rendered whenever `TWINGS_MAKER_BLOG=on`, even before the creative writes their first post.
 */
export function ProfileTabs({
  locale,
  handle,
  active,
  hasWorks,
  postCount,
  labels,
}: {
  locale: Locale;
  handle: string;
  active: 'profile' | 'blog';
  hasWorks: boolean;
  postCount: number;
  labels: {
    templates: string;
    blog: string;
    works: string;
  };
}) {
  const profileUrl = makerHref(locale, handle);
  const blogUrl = makerBlogListHref(locale, handle);

  const pillClass = (current: boolean) =>
    `inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
      current
        ? 'bg-[#09090B] text-white'
        : 'bg-[#F4F4F5] text-[#52525B] hover:bg-[#E4E4E7] hover:text-[#09090B]'
    }`;

  return (
    <nav
      data-maker-blog-tabs
      aria-label={labels.blog}
      className="mt-10 flex flex-wrap items-center gap-2 border-t border-[#09090B]/[0.08] pt-6 sm:px-8 lg:px-10"
    >
      <a
        href={active === 'profile' ? '#rail-maker' : `${profileUrl}#rail-maker`}
        aria-current={active === 'profile' ? 'page' : undefined}
        className={pillClass(active === 'profile')}
      >
        {labels.templates}
      </a>
      <a
        href={blogUrl}
        aria-current={active === 'blog' ? 'page' : undefined}
        className={pillClass(active === 'blog')}
      >
        <span>{labels.blog}</span>
        {postCount > 0 ? (
          <span
            className={`tabular-nums text-xs ${
              active === 'blog' ? 'text-white/80' : 'text-[#71717A]'
            }`}
          >
            {postCount}
          </span>
        ) : null}
      </a>
      {hasWorks ? (
        <a
          href={active === 'profile' ? '#works' : `${profileUrl}#works`}
          className={pillClass(false)}
        >
          {labels.works}
        </a>
      ) : null}
    </nav>
  );
}
