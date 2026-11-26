import type { Locale } from '@/lib/i18n/config';
import { makerBlogPostHref } from '@/lib/posts/links';
import type { TemplateStoryCard } from '@/lib/posts/public';
import { CreativeAvatar } from '@/components/makers/identity';

/**
 * Shown on `/[locale]/t/[slug]` ("이 템플릿 이야기") only when `TWINGS_MAKER_BLOG=on` and the
 * template's own supplier published at least one post linking this template.
 */
export function TemplateStories({
  stories,
  locale,
  heading,
  lede,
}: {
  stories: readonly TemplateStoryCard[];
  locale: Locale;
  heading: string;
  lede: string;
}) {
  if (stories.length === 0) return null;

  return (
    <section
      data-maker-blog-stories
      className="mt-16 border-t border-[#09090B]/[0.08] pt-10"
    >
      <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[1.2] font-bold tracking-[-0.025em] break-keep text-[#09090B]">
        {heading}
      </h2>
      <p className="mt-2 max-w-detail break-keep text-sm leading-relaxed text-[#52525B]">{lede}</p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story) => (
          <li key={`${story.handle}-${story.slug}`}>
            <a
              href={makerBlogPostHref(locale, story.handle, story.slug)}
              data-maker-blog-story={`${story.handle}/${story.slug}`}
              className="group flex h-full flex-col justify-between rounded-[16px] border border-[#09090B]/[0.08] bg-white p-5 transition-colors hover:border-[#09090B]/[0.2] hover:bg-[#F4F4F5]/50"
            >
              <div>
                <h3 className="line-clamp-2 break-keep text-[17px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#09090B] group-hover:underline">
                  {story.title}
                </h3>
                {story.summary ? (
                  <p className="mt-2 line-clamp-2 break-keep text-sm leading-relaxed text-[#52525B]">
                    {story.summary}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex items-center gap-2.5 pt-2 text-xs text-[#71717A]">
                <CreativeAvatar handle={story.handle} name={story.authorName} src={story.authorAvatar} size={24} />
                <span className="truncate font-medium text-[#09090B]">
                  {story.authorName ?? `@${story.handle}`}
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
