import type { ReactNode } from 'react';
import type { Neighbours } from '@/lib/content/load';
import type { ShapedAssetRef, ShapedRevision, ShapedStep } from '@/lib/content/shape';
import type { UpgradeIntent } from '@/lib/billing/links';
import { formatCost, formatDate, interpolate, localize } from '@/lib/i18n/format';
import { TextSwap } from '@/components/ui/text-swap';
import { UpgradeCta } from '@/components/billing/upgrade-cta';
import { BlockView } from './blocks';
import { stepAnchor, type PlaybookLabels } from './labels';

/**
 * PLAN §3.3 — the detail page's server-rendered parts: header, step timeline, the conversion strip
 * at the bottom and prev/next. Motion budget here is §5.3's "calm" tier: no pins, no scrubs, only
 * the text-swap hover the design system already owns.
 */

// ---------------------------------------------------------------------------
// header
// ---------------------------------------------------------------------------

function HeroFrame({ hero, alt }: { hero: ShapedAssetRef | null; alt: string }) {
  if (hero === null) return null;
  if (hero.mime.startsWith('video/')) {
    return (
      <video
        src={hero.src}
        className="w-full border border-hairline"
        controls
        muted
        loop
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- public or gateway URL, no loader needed
    <img
      src={hero.src}
      alt={alt}
      {...(hero.w ? { width: hero.w } : {})}
      {...(hero.h ? { height: hero.h } : {})}
      className="aspect-16/9 w-full border border-hairline object-cover"
      decoding="async"
    />
  );
}

function MetaItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-t border-hairline pt-3">
      <dt className="font-label text-eyebrow uppercase opacity-60">{term}</dt>
      <dd className="mt-1.5 font-mono text-code">{children}</dd>
    </div>
  );
}

export function DetailHeader({
  playbook,
  locale,
  labels,
  categoryLabel,
  difficultyLabel,
}: {
  playbook: ShapedRevision;
  locale: string;
  labels: PlaybookLabels;
  categoryLabel: string;
  difficultyLabel: string;
}) {
  const title = localize(playbook.title, locale);
  const updated = formatDate(playbook.published_at, locale);

  return (
    <header className="pt-10 lg:pt-16">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-label text-eyebrow uppercase">
        <span className="text-accent">{labels.eyebrow}</span>
        <span aria-hidden className="opacity-40">
          /
        </span>
        <span className="opacity-60">{categoryLabel}</span>
        <span aria-hidden className="opacity-40">
          /
        </span>
        <span className="opacity-60">{difficultyLabel}</span>
        {playbook.is_showcase && (
          <span className="border border-hairline px-2 py-0.5 opacity-80">{labels.showcase}</span>
        )}
      </div>

      <h1 className="mt-6 font-display text-title font-black uppercase">{title}</h1>

      <p className="mt-6 max-w-detail text-body opacity-70">{localize(playbook.summary, locale)}</p>

      <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
        {playbook.est_time_min !== null && (
          <MetaItem term={labels.metaTime}>
            {interpolate(labels.minutes, { count: playbook.est_time_min })}
          </MetaItem>
        )}
        {playbook.est_cost_usd !== null && (
          <MetaItem term={labels.metaCost}>{formatCost(playbook.est_cost_usd, locale)}</MetaItem>
        )}
        <MetaItem term={labels.metaSteps}>{playbook.steps.length}</MetaItem>
        {playbook.models.length > 0 && (
          <MetaItem term={labels.metaModels}>{playbook.models.join(' · ')}</MetaItem>
        )}
        {playbook.tools.length > 0 && (
          <MetaItem term={labels.metaTools}>{playbook.tools.join(' · ')}</MetaItem>
        )}
      </dl>

      <p className="mt-8 font-mono text-code opacity-60">
        {updated ? interpolate(labels.updated, { date: updated }) : labels.neverUpdated}
        <span aria-hidden> · </span>
        {interpolate(labels.revision, { n: playbook.rev_no })}
      </p>

      {playbook.change_note && (
        <aside className="mt-6 border-l-2 border-accent pl-5">
          <p className="font-label text-eyebrow uppercase opacity-60">{labels.changeNote}</p>
          <p className="mt-2 text-body">{localize(playbook.change_note, locale)}</p>
        </aside>
      )}

      <div className="mt-10">
        <HeroFrame hero={playbook.hero} alt={title} />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

function Step({
  step,
  locale,
  labels,
  canCopy,
  upgrade,
}: {
  step: ShapedStep;
  locale: string;
  labels: PlaybookLabels;
  canCopy: boolean;
  upgrade?: UpgradeIntent;
}) {
  return (
    <section
      id={stepAnchor(step.order)}
      data-step={step.order}
      data-locked-count={step.lockedCount}
      className="scroll-mt-24 border-t border-hairline pt-10"
    >
      <p className="font-mono text-code opacity-60">
        {interpolate(labels.stepLabel, { n: step.order })}
      </p>
      <h2 className="mt-3 font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[0.98] font-black uppercase">
        {localize(step.title, locale)}
      </h2>
      {step.body && <p className="mt-5 text-body opacity-70">{localize(step.body, locale)}</p>}

      <div className="mt-8 space-y-5">
        {step.blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            locale={locale}
            labels={labels}
            canCopy={canCopy}
            {...(upgrade === undefined ? {} : { upgrade })}
          />
        ))}
      </div>
    </section>
  );
}

export function StepTimeline({
  steps,
  locale,
  labels,
  tier,
  upgrade,
}: {
  steps: ShapedStep[];
  locale: string;
  labels: PlaybookLabels;
  tier: ShapedRevision['tier'];
  upgrade?: UpgradeIntent;
}) {
  // "One-click copy on prompts and params" is a Pro line on the pricing table (§3.4 / plan copy).
  const canCopy = tier === 'pro' || tier === 'admin';
  return (
    <div className="mt-16 space-y-16">
      {steps.map((step) => (
        <Step
          key={step.id}
          step={step}
          locale={locale}
          labels={labels}
          canCopy={canCopy}
          {...(upgrade === undefined ? {} : { upgrade })}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// bottom of page (§3.3)
// ---------------------------------------------------------------------------

/** §3.3 "inline Pro CTA if any block was locked" — shown only then, never as permanent furniture. */
export function ProCta({
  lockedCount,
  locale,
  labels,
  upgrade,
}: {
  lockedCount: number;
  locale: string;
  labels: PlaybookLabels;
  upgrade?: UpgradeIntent;
}) {
  if (lockedCount === 0) return null;
  const ctaClass = 'text-accent mt-6 inline-block font-label text-label uppercase';
  return (
    <aside className="mt-16 border border-accent p-6 sm:p-8">
      <p className="font-display text-[clamp(1.5rem,2.6vw,2.125rem)] leading-[1] font-black uppercase">
        {interpolate(labels.proCtaHeading, { count: lockedCount })}
      </p>
      <p className="mt-4 max-w-detail text-body opacity-70">{labels.proCtaBody}</p>
      {upgrade === undefined ? (
        <a href={`/${locale}/pricing`} className={ctaClass}>
          <TextSwap>{labels.lockedCta} →</TextSwap>
        </a>
      ) : (
        <UpgradeCta intent={upgrade} label={labels.lockedCta} className={ctaClass} />
      )}
    </aside>
  );
}

export function NeighbourNav({
  neighbours,
  locale,
  labels,
}: {
  neighbours: Neighbours;
  locale: string;
  labels: PlaybookLabels;
}) {
  const link = (
    card: Neighbours['prev'],
    label: string,
    align: 'left' | 'right',
    arrow: string,
  ) => {
    if (card === null) return <span />;
    return (
      <a
        href={`/${locale}/p/${card.slug}`}
        className={align === 'right' ? 'text-right' : undefined}
      >
        <span className="block font-label text-eyebrow uppercase opacity-60">{label}</span>
        <span className="mt-2 block font-display text-[1.35rem] leading-tight font-black uppercase">
          {align === 'left' ? `${arrow} ` : ''}
          {localize(card.title, locale)}
          {align === 'right' ? ` ${arrow}` : ''}
        </span>
      </a>
    );
  };

  return (
    <nav className="mt-16 grid grid-cols-2 gap-8 border-t border-hairline pt-10">
      {link(neighbours.prev, labels.prevLabel, 'left', '←')}
      {link(neighbours.next, labels.nextLabel, 'right', '→')}
    </nav>
  );
}
