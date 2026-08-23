import type { PromptCard as PromptCardData } from '@/lib/prompts/catalog';
import { promptHref } from '@/lib/prompts/links';
import { badgeFor } from '@/lib/content/badges';
import { PromptCardMedia } from './card-media';
import { TypographicPoster } from './poster';
import type { PromptLabels } from './labels';

/** §13.2, founder pass 2026-08-14 — one ratio for the whole wall. */
export const CARD_RATIO = '16 / 9';

/**
 * PLAN §13.2 — the gallery card. Media first, one line of type, and nothing else.
 *
 * What it carries is exactly the public projection (`lib/prompts/catalog.ts`): poster, clip, title,
 * credit, model chip, lock chip, NEW badge. **No prompt text** — not truncated, not blurred, not
 * present. The page is static and cached, so everything on this card is public by definition; the
 * projection has no `text` field for it to leak.
 *
 * Structure note: this is a **stretched link**, not an `<a>` wrapping the world. The card owns a
 * copy button, and a `<button>` inside an `<a>` is invalid and unusable with a keyboard. So the
 * title holds the only anchor and its `::after` covers the card, while the button sits above it on
 * the z-axis. `.card:hover` / `.card:focus-within` still drive §5.3-6's zoom + lift unchanged.
 */
export function PromptCardView({
  card,
  locale,
  labels,
  useCaseLabels,
  now,
}: {
  card: PromptCardData;
  locale: string;
  labels: PromptLabels;
  /** use-case key → bilingual label, resolved by the caller (§3.9). */
  useCaseLabels: Record<string, string>;
  /** Injectable clock so the NEW badge is testable without waiting fourteen days. */
  now?: Date | number;
}) {
  const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
  // Founder direction (2026-08-14): every card is 16:9, and a portrait clip is LETTERBOXED into
  // it rather than cropped — the reference form. The masonry rhythm went with it deliberately: a
  // wall of one ratio reads as a catalogue, and a 9:16 result stays whole instead of losing its
  // top and bottom to a cover crop. `card-media` paints the bars (black, object-contain).
  const ratio = CARD_RATIO;

  const badge = badgeFor({
    firstPublishedAt: card.publishedAt,
    updatedAt: null,
    ...(now === undefined ? {} : { now }),
  });

  const credit =
    card.source === 'yagi'
      ? labels.byYagi
      : card.authorHandle
        ? labels.byAuthor.replace('{handle}', card.authorHandle)
        : labels.byAnonymous;

  return (
    <article
      data-prompt-card={card.slug}
      data-source={card.source}
      data-locked={card.lock ?? 'false'}
      className="card group relative block border border-hairline"
    >
      <div className="relative border-b border-hairline">
        <PromptCardMedia
          poster={card.poster}
          video={card.video}
          alt={labels.posterAlt}
          ratio={ratio}
          fallback={
            <TypographicPoster
              title={card.title}
              slug={card.slug}
              kicker={card.modelLabels.join(' · ')}
              ratio={ratio}
            />
          }
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="flex flex-wrap gap-2">
            {badge === 'new' && (
              <span
                data-badge="new"
                className="bg-accent px-2 py-1 font-label text-[0.6875rem] leading-none tracking-[0.12em] text-white uppercase"
              >
                {labels.badgeNew}
              </span>
            )}
          </span>
          {/* The chip names the ACTION, not the fact of a gate (2026-08-15): a `free` prompt asks
              for a sign-in and charges nothing, and saying COOKIE there was a price we do not take. */}
          {card.lock && (
            <span
              data-lock-chip={card.lock}
              className="border border-white/35 bg-black/70 px-2 py-1 font-label text-[0.6875rem] leading-none tracking-[0.12em] text-white uppercase"
            >
              {card.lock === 'cookie' ? labels.lockChip : labels.lockChipSignin}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3 font-label text-[0.65rem] tracking-[0.12em] uppercase">
          <span className="opacity-60">{credit}</span>
          {/* One chip per model (2026-08-15). A prompt run on 2.5 AND 2.0 says so, in the order
              the author checked them; `flex-wrap` keeps a four-model row from pushing the credit
              off the card at the narrowest column. */}
          <span className="flex flex-wrap justify-end gap-x-2 text-accent">
            {card.modelLabels.map((label) => (
              <span key={label} data-model-chip>
                {label}
              </span>
            ))}
          </span>
        </div>

        <h3 className="font-display text-[clamp(1.35rem,2vw,1.75rem)] leading-[0.95] font-black uppercase">
          <a
            href={promptHref(locale, card.slug)}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </a>
        </h3>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-hairline pt-3">
          <span className="flex flex-wrap gap-1.5 font-mono text-[0.7rem] opacity-55">
            {card.useCase.map((value) => (
              <span key={value}>{useCaseLabels[value] ?? value}</span>
            ))}
          </span>
          {/**
           * "자세히 보기", not "프롬프트 복사" (founder direction, 2026-08-15).
           *
           * Copy-from-the-card was technically fine — the text came from the entitlement-checked
           * endpoint, never from the HTML — but it let a reader take the one thing the product
           * sells without ever seeing the page that explains it, funds it and now hands it to
           * Higgsfield. The prompt is obtained on its OWN page; the card's job is to make you want
           * to go there.
           *
           * A second anchor rather than a button: it is a navigation, so it should be one — and
           * `relative z-10` lifts it above the title's stretched `::after` so the press lands here.
           */}
          <a
            href={promptHref(locale, card.slug)}
            data-card-detail={card.slug}
            className="relative z-10 border border-hairline px-3 py-1.5 font-label text-[0.65rem] tracking-[0.12em] uppercase transition-opacity hover:opacity-70"
          >
            {labels.cardDetail}
          </a>
        </div>
      </div>
    </article>
  );
}
