import type { CampaignCard } from '@/lib/campaigns/catalog';
import type { PromptCard } from '@/lib/prompts/catalog';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { TextSwap } from '@/components/ui/text-swap';
import { CampaignCardView } from './card';
import type { CampaignLabels } from './labels';

/** A three-column grid, like the contests rails: the ORDER is the point (soonest close first). */
export function CampaignRail({
  id,
  heading,
  lede,
  cards,
  styles,
  locale,
  labels,
  now,
}: {
  id: string;
  heading: string;
  lede: string;
  cards: CampaignCard[];
  styles: Map<string, PromptCard>;
  locale: string;
  labels: CampaignLabels;
  now: Date | number;
}) {
  if (cards.length === 0) return null;
  return (
    <section data-campaign-rail={id} className="mt-16 first:mt-0 lg:mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-hairline pb-4">
        <h2 className="font-display text-[clamp(1.6rem,3.4vw,2.75rem)] leading-[0.92] font-black tracking-tight uppercase">
          {heading}
        </h2>
        <p className="font-mono text-[0.75rem] opacity-55">{lede}</p>
      </div>
      <RevealGrid itemSelector="[data-campaign-item]" className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.slug} data-campaign-item className="flex">
            <CampaignCardView
              card={card}
              style={card.styleSlug ? (styles.get(card.styleSlug) ?? null) : null}
              locale={locale}
              labels={labels}
              now={now}
            />
          </li>
        ))}
      </RevealGrid>
    </section>
  );
}

/**
 * The listing before the first client: a statement about how campaigns start here, with the one
 * CTA that turns an empty page into a lead — the same enquiry mailto the contests use, because it
 * lands in the same inbox.
 */
export function CampaignsEmptyState({ title, body, cta, mailto }: { title: string; body: string; cta: string; mailto: string }) {
  return (
    <section data-campaigns-empty className="mt-8 border-t border-hairline pt-8 lg:mt-10 lg:pt-10">
      <div className="max-w-detail">
        <p className="font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">{title}</p>
        <p className="mt-6 text-body opacity-70">{body}</p>
        <a
          href={mailto}
          className="text-accent mt-9 inline-flex min-h-12 items-center border border-current px-6 py-3.5 font-label text-[1rem] tracking-[0.1em] uppercase"
        >
          <TextSwap>{cta} →</TextSwap>
        </a>
      </div>
    </section>
  );
}

/** How it works, in five steps — the creator's whole journey, stated before they apply. */
export function CampaignSteps({ heading, steps }: { heading: string; steps: string[] }) {
  return (
    <section data-campaign-steps className="mt-16 border-t border-hairline pt-10 lg:mt-24">
      <h2 className="font-display text-[clamp(1.4rem,2.6vw,2.1rem)] leading-[0.95] font-black uppercase">{heading}</h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step} className="border-t border-current pt-3">
            <p className="font-mono text-[0.7rem] opacity-50">0{index + 1}</p>
            <p className="mt-2 text-[0.95rem] leading-snug">{step}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
