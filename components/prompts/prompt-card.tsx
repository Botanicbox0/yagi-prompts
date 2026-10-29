import type { PromptCard as PromptCardData } from '@/lib/prompts/catalog';
import { templateHref } from '@/lib/prompts/links';
import { badgeFor } from '@/lib/content/badges';
import { PromptCardMedia } from './card-media';
import { TypographicPoster } from './poster';
import { CARD_RATIOS, cardAspect, cardAuthor, cardFrame } from './card-frame';
import type { PromptLabels } from './labels';

/**
 * PLAN §13.2, revised by docs/PLATFORM-2.0.md §15.3-4 — the gallery card. Media first, then the
 * title, and only what helps the reader choose: how long, what shape, whether it is new, and — for
 * a creator's format — whose it is.
 *
 * What it carries is exactly the public projection (`lib/prompts/catalog.ts`). **No prompt text**,
 * no price (founder 2026-09-07: the template page names it), and since 2026-10-23 no engine name:
 * the reader buys a format, not a model (§12 "모델 선택 UI 없음").
 *
 * Structure: a **stretched link**. The title holds the only anchor and its `::after` covers the
 * card, so the whole card is one link with no secondary CTA. The media's play/stop button is the
 * one other control; it sits above the overlay on the z-axis, outside the zoomed media layer.
 */
export function PromptCardView({
  card,
  locale,
  labels,
  now,
}: {
  card: PromptCardData;
  locale: string;
  labels: PromptLabels;
  /** Kept for callers that still pass it; the card no longer prints use cases. */
  useCaseLabels?: Record<string, string>;
  /** Injectable clock so the NEW badge is testable without waiting fourteen days. */
  now?: Date | number;
}) {
  const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  const frame = cardFrame(card);
  const ratio = CARD_RATIOS[frame];
  const author = cardAuthor(card);
  const seconds = card.medium === 'video' && card.runtimeSeconds && card.runtimeSeconds > 0 ? card.runtimeSeconds : null;

  const badge = badgeFor({
    firstPublishedAt: card.publishedAt,
    updatedAt: null,
    ...(now === undefined ? {} : { now }),
  });

  return (
    <article
      data-prompt-card={card.slug}
      data-source={card.source}
      data-medium={card.medium}
      data-frame={frame}
      className="card group relative flex min-w-0 flex-col"
    >
      <div className="relative shrink-0 overflow-hidden rounded-lg bg-black">
        <PromptCardMedia
          poster={card.poster}
          video={card.video}
          alt={title}
          ratio={ratio}
          // A portrait clip fills its 4:5 window; a wide one keeps the reference letterbox.
          fit={frame === 'portrait' ? 'cover' : 'contain'}
          controlLabels={{ play: labels.cardPlay, pause: labels.cardPause }}
          fallback={<TypographicPoster title={card.title} slug={card.slug} kicker="" ratio={ratio} />}
        />

        {badge === 'new' && (
          <span
            data-badge="new"
            className="pointer-events-none absolute top-2 left-2 rounded-full bg-accent px-2 py-1 text-[0.6875rem] leading-none font-semibold text-white"
          >
            {labels.badgeNew}
          </span>
        )}

        {/* The template page shows this one's prompt (2026-10-29): the reason a creative's follower clicks. */}
        {card.recipeOpen && (
          <span
            data-card-recipe
            className="pointer-events-none absolute top-2 right-2 rounded-full bg-white px-2 py-1 text-[0.6875rem] leading-none font-semibold text-black"
          >
            {labels.cardRecipe}
          </span>
        )}

        {/* Length and shape, where a thumbnail's duration usually sits. Solid black under white
            text keeps 4.5:1 over any frame of any clip. */}
        <span className="pointer-events-none absolute bottom-2 left-2 flex gap-1 text-[0.6875rem] leading-none font-medium text-white">
          {seconds !== null && (
            <span data-card-duration className="rounded-full bg-black/80 px-2 py-1">
              {labels.cardSeconds.replace('{seconds}', String(seconds))}
            </span>
          )}
          <span data-card-aspect className="rounded-full bg-black/80 px-2 py-1">
            {cardAspect(card)}
          </span>
        </span>
      </div>

      <h3 className="mt-2.5 line-clamp-2 text-[0.95rem] leading-snug font-semibold break-keep">
        <a
          href={templateHref(locale, card.slug)}
          className="rounded-lg outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--color-blue)]"
        >
          {title}
        </a>
      </h3>
      {author && (
        <p data-card-author className="mt-1 truncate text-xs text-black/60">
          {author.handle ? labels.cardAuthor.replace('{handle}', author.handle) : labels.cardAuthorAnonymous}
        </p>
      )}
    </article>
  );
}
