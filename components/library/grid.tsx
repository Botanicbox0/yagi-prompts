import type { LibraryCard } from '@/lib/content/library';
import { publicContentUrl } from '@/lib/content/asset-url';
import { heroRef, mediaGatewayPath } from '@/lib/content/media-ref';
import { PlaybookCard, type CardLabels } from '@/components/landing/playbook-card';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * PLAN §3.2 — the library grid. Cards are the M1 component, given a different link target and a
 * hero source that can go through the entitlement gateway: past the login wall the reader is
 * eligible for every published playbook, so their heroes can be served even with no public CDN
 * configured (§11) — which is also why this grid is never cached (§3.4).
 *
 * §4 layout: the `.band` content column, two-up from the `wide` (1180) breakpoint.
 */

export interface GridLabels extends CardLabels {
  emptyTitle: string;
  emptyBody: string;
  catalogEmptyTitle: string;
  catalogEmptyBody: string;
  clear: string;
}

function heroSrcFor(card: LibraryCard): string | null {
  if (!card.hero) return null;
  return publicContentUrl(card.hero.key) ?? mediaGatewayPath(heroRef(card.revisionId));
}

export function LibraryGrid({
  cards,
  locale,
  labels,
  categoryLabel,
  difficultyLabel,
}: {
  cards: LibraryCard[];
  locale: string;
  labels: GridLabels;
  categoryLabel: (key: string) => string;
  difficultyLabel: (key: string) => string;
}) {
  return (
    <ul className="grid gap-6 wide:grid-cols-2">
      {cards.map((card, index) => (
        <li key={card.slug}>
          <PlaybookCard
            card={card}
            index={index + 1}
            locale={locale}
            href={`/${locale}/p/${card.slug}`}
            heroSrc={heroSrcFor(card)}
            categoryLabel={categoryLabel(card.category)}
            difficultyLabel={difficultyLabel(card.difficulty)}
            labels={labels}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Two different emptinesses with two different answers (§3.2 "empty states"):
 * a filter that matched nothing is the reader's move to undo; an empty catalog is ours to fill.
 */
export function LibraryEmpty({
  filtered,
  labels,
}: {
  filtered: boolean;
  labels: GridLabels;
}) {
  return (
    <div className="border border-hairline p-10">
      <p className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[0.95] font-black uppercase">
        {filtered ? labels.emptyTitle : labels.catalogEmptyTitle}
      </p>
      <p className="mt-5 max-w-detail text-body opacity-70">
        {filtered ? labels.emptyBody : labels.catalogEmptyBody}
      </p>
      {filtered && (
        <a href="/library" className="text-accent mt-8 inline-block font-label text-label uppercase">
          <TextSwap>{labels.clear} →</TextSwap>
        </a>
      )}
    </div>
  );
}

/** §3.2 "Empty/loading states: skeletons (no spinners)." Rendered by app/(app)/library/loading.tsx. */
export function LibrarySkeleton({ label, count = 4 }: { label: string; count?: number }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <ul className="grid gap-6 wide:grid-cols-2">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="border border-hairline">
            <div className="aspect-16/10 w-full border-b border-hairline bg-hairline" />
            <div className="space-y-4 p-5">
              <div className="h-3 w-24 bg-hairline" />
              <div className="h-7 w-3/4 bg-hairline" />
              <div className="h-3 w-full bg-hairline" />
              <div className="h-3 w-2/3 bg-hairline" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
