import type { PromptCard } from '@/lib/prompts/catalog';
import type { ShapedPrompt } from '@/lib/prompts/shape';
import type { UnlockPanel } from '@/lib/cookies/wallet';
import { PACK_COOKIES, PACK_PRICE_USD } from '@/lib/cookies/wallet';
import { promptHref, promptsHref, PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import { interpolate } from '@/lib/i18n/format';
import { BillingUnavailable } from '@/components/billing/upgrade-cta';
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
 *
 * §15.3 made the lock panel the funnel: which of its three variants renders is ALSO decided
 * upstream (`unlockPanel`, resolved next to the gate in lib/prompts/access.ts), so the panel and
 * the wallet can never disagree about what a press would do.
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

      {/* The audio result (founder direction, 2026-08-13): playable inline, downloadable in one
          press. The href carries `?download=1` so the route answers Content-Disposition —
          the anchor `download` attribute alone is ignored cross-origin. */}
      {prompt.audio && (
        <div data-prompt-audio className="mt-6 border border-hairline p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="font-label text-eyebrow uppercase opacity-60">
              {labels.audioLabel}
            </span>
            <a
              href={`${prompt.audio.src}${prompt.audio.src.includes('?') ? '&' : '?'}download=1`}
              download
              data-audio-download
              className="text-accent font-mono text-code underline-offset-4 hover:underline"
            >
              {labels.audioDownload} ↓
            </a>
          </div>
          <audio controls preload="none" src={prompt.audio.src} className="mt-3 w-full" />
        </div>
      )}

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
 * The §15.3 funnel, one variant per resolved panel state:
 *
 *   'signin'       a link into Journey A that returns to THIS prompt — never a form anon cannot
 *                  POST;
 *   'spend'        a JS-free form to the unlock server action, wearing the real balance;
 *   'empty'        the wallet panel: the weekly line, and the $4/5 pack in the §11 designed
 *                  not-connected state (`BillingUnavailable`) — a fact, not a dead button;
 *   'unavailable'  the wallet could not be read (F5) — one factual sentence in a hairline
 *                  panel. No pack pitch, no zero-balance claim: both would be statements about
 *                  a wallet nobody read.
 */
function UnlockPanelView({
  panel,
  prompt,
  locale,
  labels,
  signinHref,
  unlockAction,
  packReady = false,
  packAction,
}: {
  panel: UnlockPanel;
  prompt: ShapedPrompt;
  locale: string;
  labels: PromptLabels;
  signinHref: string;
  unlockAction?: (form: FormData) => Promise<void>;
  packReady?: boolean;
  packAction?: (form: FormData) => Promise<void>;
}) {
  if (panel.state === 'signin') {
    return (
      <div>
        <a data-unlock-cta="signin" href={signinHref} className={`text-accent ${CTA_CLASS}`}>
          <TextSwap>{labels.signinCta} →</TextSwap>
        </a>
        <p className="mt-3 font-mono text-[0.72rem] opacity-45">
          {interpolate(labels.signinHint, { count: '3' })}
        </p>
      </div>
    );
  }

  if (panel.state === 'spend') {
    return (
      <form action={unlockAction} data-unlock-cta="spend" className="inline-block">
        <input type="hidden" name="id" value={prompt.id} />
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className={CTA_CLASS}>
          <TextSwap>{interpolate(labels.spendCta, { count: String(panel.balance) })} →</TextSwap>
        </button>
        <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.spendNote}</p>
      </form>
    );
  }

  if (panel.state === 'unavailable') {
    return (
      <div data-unlock-cta="unavailable" className="border border-hairline p-6 sm:p-8">
        <p className="text-[0.9375rem] opacity-70">{labels.walletUnavailable}</p>
      </div>
    );
  }

  const packTitle = interpolate(labels.packTitle, {
    count: String(PACK_COOKIES),
    price: `$${PACK_PRICE_USD}`,
  });

  return (
    <div data-unlock-cta="empty">
      <p className="font-display text-[clamp(1.2rem,2vw,1.5rem)] leading-[1] font-black uppercase">
        {labels.emptyTitle}
      </p>
      <p className="mt-3 text-[0.9375rem] opacity-70">{labels.weeklyLine}</p>
      {packReady ? (
        // M8, when a merchant-of-record is connected: the pack is a real one-press form.
        <form action={packAction} data-cookie-pack className="mt-5">
          <input type="hidden" name="id" value={prompt.id} />
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className={CTA_CLASS}>
            <TextSwap>
              {interpolate(labels.packCta, {
                count: String(PACK_COOKIES),
                price: `$${PACK_PRICE_USD}`,
              })}{' '}
              →
            </TextSwap>
          </button>
          <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.packNote}</p>
        </form>
      ) : (
        // §15.1-5 today: no gateway, so the pack states its price and its status honestly.
        <BillingUnavailable
          className="mt-5"
          title={packTitle}
          body={`${labels.packNote} ${labels.packUnavailableBody}`}
        />
      )}
    </div>
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
  panel,
  signinHref,
  unlockAction,
  packReady,
  packAction,
}: {
  prompt: ShapedPrompt;
  locale: string;
  labels: PromptLabels;
  /** §15.3 — resolved next to the gate; null when the text is visible (or nothing is for sale). */
  panel: UnlockPanel | null;
  signinHref: string;
  /** The unlock server action; bound by the page, absent in static renders. */
  unlockAction?: (form: FormData) => Promise<void>;
  /** §15.1-5 — false until an M8 MoR is connected; decides form vs the designed unavailable. */
  packReady?: boolean;
  packAction?: (form: FormData) => Promise<void>;
}) {
  return (
    <section className="mt-14 border-t border-hairline pt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-label text-label uppercase">{labels.promptHeading}</h2>
        {!prompt.locked && (
          <PromptCopyButton
            id={prompt.id}
            signinHref={signinHref}
            upgradeHref={promptHref(locale, prompt.slug)}
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
          {panel !== null && (
            <UnlockPanelView
              panel={panel}
              prompt={prompt}
              locale={locale}
              labels={labels}
              signinHref={signinHref}
              unlockAction={unlockAction}
              {...(packReady === undefined ? {} : { packReady })}
              {...(packAction === undefined ? {} : { packAction })}
            />
          )}
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
}: {
  cards: PromptCard[];
  locale: string;
  labels: PromptLabels;
  useCaseLabels: Record<string, string>;
  signinHref: string;
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
