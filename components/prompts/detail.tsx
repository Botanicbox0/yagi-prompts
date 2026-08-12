import type { PromptCard } from '@/lib/prompts/catalog';
import type { ShapedPrompt } from '@/lib/prompts/shape';
import { promptsHref, PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import type { UpgradeIntent } from '@/lib/billing/links';
import { UpgradeCta } from '@/components/billing/upgrade-cta';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptCopyButton } from './copy-button';
import { PromptDetailMedia } from './detail-media';
import { PromptCardView } from './prompt-card';
import { TypographicPoster, posterRatio } from './poster';
import type { PromptLabels } from './labels';

/**
 * PLAN §13.2 — the prompt detail page's sections.
 *
 * The gate is already decided by the time anything here renders: `shapePrompt` either put a `text`
 * key on the object or it did not. This file cannot leak, because there is nothing to leak from —
 * which is the same property `components/playbook/blocks.tsx` relies on, expressed one level up.
 */

const CTA_CLASS =
  'inline-block border border-current px-4 py-2 font-label text-eyebrow uppercase';

export function PromptHeader({
  prompt,
  labels,
  useCaseLabels,
}: {
  prompt: ShapedPrompt;
  labels: PromptLabels;
  useCaseLabels: Record<string, string>;
}) {
  const ratio =
    prompt.poster?.w && prompt.poster.h
      ? `${prompt.poster.w} / ${prompt.poster.h}`
      : posterRatio(prompt.slug);

  const credit =
    prompt.source === 'yagi'
      ? labels.byYagi
      : prompt.authorHandle
        ? labels.byAuthor.replace('{handle}', prompt.authorHandle)
        : labels.byAnonymous;

  return (
    <header>
      <PromptDetailMedia
        poster={prompt.poster}
        video={prompt.video}
        alt={labels.resultLabel}
        ratio={ratio}
        fallback={
          <TypographicPoster
            title={prompt.title}
            slug={prompt.slug}
            kicker={prompt.model.toUpperCase()}
            ratio={ratio}
          />
        }
      />

      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 font-label text-eyebrow uppercase">
        <span className="opacity-60">{credit}</span>
        <span aria-hidden className="opacity-30">
          /
        </span>
        <span data-model-chip className="text-accent">
          {prompt.model.toUpperCase().replace(/-/g, ' ')}
        </span>
      </div>

      <h1 className="mt-5 font-display text-[clamp(2.25rem,5.5vw,4rem)] leading-[0.92] font-black uppercase">
        {prompt.title}
      </h1>
      {prompt.titleKo && prompt.titleKo !== prompt.title && (
        <p className="mt-3 text-body opacity-60">{prompt.titleKo}</p>
      )}

      {prompt.useCase.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {prompt.useCase.map((value) => (
            <li
              key={value}
              className="border border-hairline px-3 py-1 font-label text-[0.65rem] tracking-[0.12em] uppercase opacity-70"
            >
              {useCaseLabels[value] ?? value}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

/**
 * The text, or §5.5's lock panel. Never both, never a teaser, never a blur.
 *
 * The `locked` discriminant is the shaper's, so the branch below is a rendering decision about an
 * object that already does or does not carry the string.
 */
export function PromptBody({
  prompt,
  locale,
  labels,
  upgrade,
  signinHref,
  upgradeHref,
}: {
  prompt: ShapedPrompt;
  locale: string;
  labels: PromptLabels;
  upgrade: UpgradeIntent;
  signinHref: string;
  upgradeHref: string;
}) {
  return (
    <section className="mt-14 border-t border-hairline pt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-label text-label uppercase">{labels.promptHeading}</h2>
        {!prompt.locked && (
          <PromptCopyButton
            id={prompt.id}
            signinHref={signinHref}
            upgradeHref={upgradeHref}
            labels={{
              copy: labels.copy,
              copied: labels.copied,
              failed: labels.copyFailed,
              locked: labels.copyLocked,
            }}
            className="border border-hairline px-4 py-2 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
          />
        )}
      </div>

      {prompt.locked ? (
        <div className="mt-6 lock-panel" data-lock-panel data-locked="true">
          <div>
            <p className="font-label text-label uppercase">{labels.lockedHeading}</p>
            <p className="mt-2 text-[0.9375rem] opacity-70">{labels.lockedBody}</p>
          </div>
          <UpgradeCta intent={upgrade} label={labels.lockedCta} className={CTA_CLASS} />
        </div>
      ) : (
        <>
          <pre
            data-prompt-text
            data-locked="false"
            className="mt-6 overflow-x-auto border border-hairline p-5 font-mono text-code whitespace-pre-wrap"
          >
            {prompt.text}
          </pre>
          <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.promptNote}</p>
        </>
      )}

      <p className="mt-8">
        <a href={promptsHref(locale)} className="text-accent font-label text-eyebrow uppercase">
          ← {labels.backToGallery}
        </a>
      </p>
    </section>
  );
}

export function RelatedPrompts({
  cards,
  locale,
  labels,
  useCaseLabels,
  signinHref,
  upgradeHref,
}: {
  cards: PromptCard[];
  locale: string;
  labels: PromptLabels;
  useCaseLabels: Record<string, string>;
  signinHref: string;
  upgradeHref: string;
}) {
  if (cards.length === 0) return null;

  return (
    <section className="mt-16 border-t border-hairline pt-10">
      <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">
        {labels.relatedHeading}
      </h2>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.slug}>
            <PromptCardView
              card={card}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
              signinHref={signinHref}
              upgradeHref={upgradeHref}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** §13.2 — the submit CTA strip, on the gallery and at the bottom of every detail page. */
export function SubmitStrip({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <aside data-submit-strip className="mt-16 border border-hairline p-8 sm:p-10">
      <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.95] font-black uppercase">
        {title}
      </p>
      <p className="mt-4 max-w-detail text-body opacity-70">{body}</p>
      <a href={PROMPT_SUBMIT_PATH} className={`text-accent mt-7 ${CTA_CLASS}`}>
        <TextSwap>{cta} →</TextSwap>
      </a>
    </aside>
  );
}
