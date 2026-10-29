import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { brandStory } from '@/lib/campaigns/brand-stories';
import { formatCampaignMetric } from '@/lib/campaigns/case-studies';
import { MorphicFilmPair } from './brand-experience';

/** The same evidence module serves the landing and permanent customer story URL. */
export function BrandCustomerStory({ dict, locale, detail = false }: { dict: Dictionary; locale: Locale; detail?: boolean }) {
  const story = brandStory('morphic');
  if (!story) throw new Error('Missing approved customer story.');
  const t = dict.brandLanding;
  const Heading = detail ? 'h2' : 'h3';
  return <div data-customer-story={story.slug} className="overflow-hidden rounded-3xl border border-white/15 bg-brand-ink">
    {story.campaigns.map((campaign, index) => {
      const copy = t.cases[campaign.copyKey];
      return <article key={campaign.id} id={campaign.id} data-case-study={campaign.id} className="scroll-mt-24 border-b border-white/15 p-6 last:border-0 sm:p-9 lg:p-12">
        <p className="font-label text-xs tracking-wider text-brand-blue-light">{copy.eyebrow}</p>
        <div className="mt-6 grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <Heading className="whitespace-pre-line text-[clamp(2rem,4vw,3.8rem)] font-semibold leading-[1.06] tracking-[-0.055em]">{index === 0 ? t.stories.augustHeading : t.stories.septemberHeading}</Heading>
            <p className="mt-6 max-w-xl text-sm leading-relaxed text-white/65">{copy.body}</p>
            {campaign.metrics.length > 0 && <>
              <dl className="mt-8 grid grid-cols-3 gap-5 border-y border-white/15 py-6">
                {campaign.metrics.map(metric => <div key={metric.id} data-case-metric={metric.id} className="min-w-0">
                  <dd className="whitespace-nowrap text-[clamp(1.25rem,2.4vw,2.5rem)] font-semibold leading-none tracking-[-0.05em]">{formatCampaignMetric(metric, locale)}</dd>
                  <dt className="mt-3 text-xs leading-relaxed text-white/60">{t.cases.morphic90s.metrics[metric.id].label}</dt>
                </div>)}
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-white/55">{t.stories.scope}</p>
            </>}
            {campaign.id === 'morphic-september-kr-jp' && <div className="mt-7" data-case-post-list>
              <p className="text-xs text-white/60">{t.cases.morphicSeptember.postsHeading}</p>
              <ul aria-label={t.cases.morphicSeptember.postsHeading} className="mt-3 grid gap-3 sm:grid-cols-2">
                {campaign.posts.map(post => <li key={post.id}>
                  <a href={post.url} data-case-post={post.id} data-post-market={post.market} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-white/20 px-4 py-3 text-sm transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-blue-light">
                    <span>{t.stories.postLabels[post.id]}</span><span aria-hidden="true">↗</span>
                  </a>
                </li>)}
              </ul>
            </div>}
            {detail && campaign.sourceUrl && <a data-case-source={campaign.id} href={campaign.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-7 inline-flex min-h-11 items-center text-sm text-white/65 underline underline-offset-6">{t.cases.morphic90s.sourceCta} ↗</a>}
            {!detail && index === 0 && <a href={`/${locale}/brands/stories/morphic`} className="mt-4 flex min-h-11 w-fit items-center gap-5 rounded-full bg-blue px-5 text-sm font-semibold">{t.stories.detailCta} ↗</a>}
          </div>
          <div>
            <MorphicFilmPair media={campaign.media} labels={{ titles: copy.films, play: t.media.play, pause: t.media.pause, post: index === 0 ? t.cases.morphic90s.postCta : undefined }} />
            <p className="mt-4 text-xs leading-relaxed text-white/55">{index === 0 ? t.cases.morphic90s.filmNote : t.cases.morphicSeptember.note}</p>
          </div>
        </div>
        {detail && index === 0 && <p className="mt-8 border-t border-white/15 pt-4 text-xs leading-relaxed text-white/55">{t.cases.morphic90s.note}</p>}
      </article>;
    })}
  </div>;
}
