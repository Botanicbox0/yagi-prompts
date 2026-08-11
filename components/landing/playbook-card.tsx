import type { CatalogCard } from '@/lib/content/catalog';
import { publicContentUrl } from '@/lib/content/asset-url';
import { playbookHref } from '@/lib/content/links';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * The generated cover.
 *
 * Fixture media is deliberately labelled placeholder bytes (§9) and, with no Supabase project yet
 * (§11), nothing serves it over HTTP — so `publicContentUrl()` answers `null` and this stands in.
 * It is not a grey box: it is a designed, deterministic composition in the two-inks language, and
 * it is what a card looks like whenever a hero is missing, which will keep happening in production.
 */
function CardCover({ index, category }: { index: number; category: string }) {
  return (
    // The cover is always white, whatever section it sits in, so it declares its own theme and
    // the accent inside it resolves to the light-surface #0000EE rather than the inverted tone.
    <div
      data-theme="light"
      className="relative flex aspect-16/10 w-full flex-col justify-between bg-white p-4 text-black"
    >
      <span aria-hidden className="absolute top-0 left-1/3 h-full w-px bg-line-light" />
      <span aria-hidden className="absolute top-0 left-2/3 h-full w-px bg-line-light" />
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line-light" />

      <div className="relative flex items-start justify-between">
        <span className="font-label text-eyebrow uppercase">{category}</span>
        <span aria-hidden className="bg-accent block h-2.5 w-2.5" />
      </div>

      <span
        aria-hidden
        className="relative font-display text-[clamp(3rem,9vw,5rem)] leading-[0.78] font-black uppercase"
        // Explicit ink, not `currentColor` — see reel-poster.tsx. The cover is always white.
        style={{ WebkitTextStroke: '1px #000000', color: 'transparent' }}
      >
        {String(index).padStart(2, '0')}
      </span>
    </div>
  );
}

export interface CardLabels {
  steps: string;
  proBlocks: string;
  open: string;
  showcase: string;
  loginWall: string;
}

/**
 * PLAN §5.3-6 — "media zoom 1.03 + lift −2px, 300ms; no text scaling."
 * The whole card is the link, so the hover state is also the focus state (`.card:focus-within`).
 */
export function PlaybookCard({
  card,
  index,
  locale,
  categoryLabel,
  difficultyLabel,
  labels,
  href,
  heroSrc,
}: {
  card: CatalogCard;
  index: number;
  locale: string;
  categoryLabel: string;
  difficultyLabel: string;
  labels: CardLabels;
  /**
   * Where the card points. Defaults to the §3.1 marketing split (showcase → detail, everything
   * else → login wall). `/library` overrides it: past the wall every published playbook opens,
   * because the funnel is a marketing rule, not an authorization one.
   */
  href?: string;
  /** Overrides the public CDN hero — the library can address media through the gateway (§3.3). */
  heroSrc?: string | null;
}) {
  const heroUrl = heroSrc !== undefined ? heroSrc : card.hero ? publicContentUrl(card.hero.key) : null;
  const title = locale === 'ko' ? card.title.ko : card.title.en;
  const summary = locale === 'ko' ? card.summary.ko : card.summary.en;

  return (
    <a href={href ?? playbookHref(locale, card)} className="card group block border border-hairline">
      <div className="card__media border-b border-hairline">
        {heroUrl && card.hero?.mime.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element -- public CDN object, no loader needed
          <img
            src={heroUrl}
            alt=""
            width={card.hero.w ?? 1600}
            height={card.hero.h ?? 1000}
            loading="lazy"
            decoding="async"
            className="aspect-16/10 w-full object-cover"
          />
        ) : (
          <CardCover index={index} category={categoryLabel} />
        )}
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3 font-label text-eyebrow uppercase opacity-60">
          <span>{categoryLabel}</span>
          <span aria-hidden>/</span>
          <span>{difficultyLabel}</span>
        </div>

        <h3 className="font-display text-[clamp(1.75rem,2.4vw,2.25rem)] leading-[0.95] font-black uppercase">
          {title}
        </h3>

        <p className="text-[0.9375rem] leading-relaxed opacity-70">{summary}</p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4 font-mono text-code">
          {/* The accent must not sit inside an opacity wrapper — the two multiply, and #0000EE
              at 60% on black measures 2.37:1. Each part carries its own alpha. */}
          <span className="flex items-center gap-2">
            <span className="opacity-60">
              {card.stepCount} {labels.steps}
            </span>
            <span aria-hidden className="opacity-40">
              ·
            </span>
            <span className="text-accent">
              {card.proBlockCount} {labels.proBlocks}
            </span>
          </span>
          <span className="font-label text-eyebrow uppercase">
            <TextSwap>{labels.open} →</TextSwap>
          </span>
        </div>
      </div>
    </a>
  );
}
