import type { CSSProperties } from 'react';
import { cardRatio } from './card-frame';
import { SIGNUP_COOKIES } from '@/lib/cookies/wallet';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { ShapedPrompt } from '@/lib/prompts/shape';
import type { UnlockPanel } from '@/lib/cookies/wallet';
import { PACK_COOKIES, PACK_PRICE_USD } from '@/lib/cookies/wallet';
import { promptHref, promptsHref, PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import { interpolate } from '@/lib/i18n/format';
import { promptModelLabel } from '@/lib/prompts/schemas';
import { promptLock } from '@/lib/prompts/lock';
import { BillingUnavailable } from '@/components/billing/upgrade-cta';
import { Markdown } from '@/components/playbook/markdown';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptCopyButton } from './copy-button';
import { PromptRunButton } from './run-button';
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

/**
 * The write-up in the reader's language, falling back to the other one.
 *
 * A fallback rather than a blank: the process notes are optional and NOT a translated pair (§13
 * treats prompts as atomic), so a Korean-only making-of on a Korean prompt should still show for
 * an English reader instead of vanishing — the alternative hides content that exists.
 */
function processFor(prompt: ShapedPrompt, locale: string): string | null {
  if (prompt.locked) return null;
  const ko = prompt.processKo?.trim() || null;
  const en = prompt.process?.trim() || null;
  return locale === 'ko' ? (ko ?? en) : (en ?? ko);
}

/** `audio/mpeg` → `MP3`. The reader wants the format, not the MIME type. */
function audioFormat(mime: string): string {
  const subtype = mime.split(';')[0]!.split('/')[1] ?? '';
  const known: Record<string, string> = {
    mpeg: 'MP3',
    'x-wav': 'WAV',
    wav: 'WAV',
    mp4: 'M4A',
    aac: 'AAC',
    ogg: 'OGG',
    flac: 'FLAC',
  };
  return known[subtype] ?? subtype.toUpperCase();
}

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
        controls={labels.mediaControls}
        fallback={
          <TypographicPoster
            title={prompt.title}
            slug={prompt.slug}
            kicker={prompt.models.map(promptModelLabel).join(' · ')}
            ratio={ratio}
          />
        }
      />

      {/**
       * The attached audio file (founder direction 2026-08-13, redesigned 2026-08-14: the first
       * cut was a bare label, a text link and a naked native player — "너무 투박"). It is now one
       * §5 unit: a black inverted strip that reads as part of the media block above it, the format
       * as a mono fact, and the download as a real bordered control rather than a sentence.
       * `?download=1` is what makes the route answer `Content-Disposition: attachment` — the
       * anchor attribute alone is ignored cross-origin.
       */}
      {prompt.audio && (
        <div data-prompt-audio data-theme="dark" className="mt-4 bg-surface p-5 text-on-surface">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex items-baseline gap-3">
              <span className="font-label text-eyebrow uppercase opacity-60">
                {labels.audioLabel}
              </span>
              <span className="font-mono text-[0.7rem] tracking-[0.08em] uppercase opacity-40">
                {audioFormat(prompt.audio.mime)}
              </span>
            </div>
            <a
              href={`${prompt.audio.src}${prompt.audio.src.includes('?') ? '&' : '?'}download=1`}
              download
              data-audio-download
              className="inline-flex items-center gap-2 border border-current px-4 py-2 font-label text-[0.68rem] tracking-[0.12em] uppercase"
            >
              <TextSwap>{labels.audioDownload}</TextSwap>
              <span aria-hidden>↓</span>
            </a>
          </div>
          {/* The native player, kept but framed — a custom transport would be a second product. */}
          <audio
            controls
            preload="none"
            src={prompt.audio.src}
            className="mt-4 h-10 w-full [color-scheme:dark]"
          />
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 font-label text-eyebrow uppercase">
        <span className="opacity-60">{credit}</span>
        <span aria-hidden className="opacity-30">
          /
        </span>
        <span className="flex flex-wrap gap-x-2 text-accent">
          {prompt.models.map((id) => (
            <span key={id} data-model-chip>
              {promptModelLabel(id)}
            </span>
          ))}
        </span>
        {/* The creator's own post (2026-08-15). `noopener` + `ugc`: an outbound link a stranger
            supplied should neither hand over the opener nor pass our ranking to them. */}
        {prompt.sourceUrl && (
          <>
            <span aria-hidden className="opacity-30">
              /
            </span>
            <a
              href={prompt.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              data-source-url
              className="opacity-60 underline-offset-4 hover:opacity-100 hover:underline"
            >
              {labels.sourceLink} ↗
            </a>
          </>
        )}
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
    // The cookie sweetener belongs to a COOKIE gate. On a free one it answers a question the
    // reader did not ask, about a currency this prompt never charges.
    const signinOnly = promptLock(prompt.visibility) === 'signin';
    return (
      <div>
        <a data-unlock-cta="signin" href={signinHref} className={`text-accent ${CTA_CLASS}`}>
          <TextSwap>{labels.signinCta} →</TextSwap>
        </a>
        <p className="mt-3 font-mono text-[0.72rem] opacity-45">
          {signinOnly ? labels.signinOnlyHint : interpolate(labels.signinHint, { count: String(SIGNUP_COOKIES) })}
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
        {/**
         * Copy, then GO (founder direction, 2026-08-15). The run button is accented and second
         * because it is the action with somewhere to arrive; copy stays a hairline utility. Both
         * appear only when the reader may actually have the text — a handoff for a prompt you
         * cannot read would open a tab with nothing in the clipboard.
         */}
        {!prompt.locked && (
          <div className="flex flex-wrap items-center gap-2">
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
            <PromptRunButton
              id={prompt.id}
              labels={{ run: labels.runCta, copied: labels.runCopied, failed: labels.runFailed }}
              className="text-accent border border-current px-4 py-2 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
            />
          </div>
        )}
      </div>

      {prompt.locked ? (
        /**
         * The panel says what THIS gate costs (founder report, 2026-08-15: "90s interview는 free인데
         * 왜 cookie 요구?"). A `free` prompt opens on sign-in and spends nothing — `unlockPrompt`
         * refuses to charge a cookie for one — so quoting the cookie copy here was asking for a
         * price the server would not take.
         */
        <div className="mt-6 lock-panel" data-lock-panel data-locked={promptLock(prompt.visibility) ?? 'true'}>
          <div>
            <p className="font-label text-label uppercase">
              {promptLock(prompt.visibility) === 'signin' ? labels.signinOnlyHeading : labels.lockedHeading}
            </p>
            <p className="mt-2 text-[0.9375rem] opacity-70">
              {promptLock(prompt.visibility) === 'signin' ? labels.signinOnlyBody : labels.lockedBody}
            </p>
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
          {/**
           * "pro로 설정했는데 왜 프롬프트 다 공개되어있음?" (founder, 2026-08-15).
           *
           * Nothing was wrong — an admin outranks every gate, because a moderator has to be able to
           * read what they moderate. But the page looked identical to a public one, so the only way
           * to check your own paywall was to open a private window. A gate you cannot see from the
           * inside is a gate you will misjudge. This says, to admins only, what a normal reader
           * would be meeting here instead.
           */}
          {prompt.tier === 'admin' && prompt.visibility !== 'public' && (
            <p
              data-admin-view={prompt.visibility}
              className="mt-6 border border-accent px-4 py-2.5 font-label text-eyebrow text-accent uppercase"
            >
              {interpolate(labels.adminBypass, { visibility: prompt.visibility })}
            </p>
          )}
          <pre
            data-prompt-text
            data-locked="false"
            className="mt-6 overflow-x-auto border border-hairline p-5 font-mono text-code whitespace-pre-wrap"
          >
            {prompt.text}
          </pre>
          <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.promptNote}</p>

          {/**
           * The making-of (founder direction, 2026-08-14): the prompt is the input, this is how it
           * was actually built. Rendered by the SAME strict markdown renderer the contests brief
           * uses — a subset with no raw HTML — so a community write-up cannot inject markup.
           * It sits INSIDE the unlocked branch because it rides the prompt's own gate.
           */}
          {processFor(prompt, locale) && (
            <section data-prompt-process className="mt-12 border-t border-hairline pt-8">
              <h3 className="font-label text-label uppercase">{labels.processHeading}</h3>
              <div className="mt-5 max-w-detail">
                <Markdown source={processFor(prompt, locale)!} />
              </div>
            </section>
          )}
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
      {/* The catalogue's own grid (rails.tsx): two 4:5 cards a row on a phone, four on a desktop.
          No three-column step — the related list is four cards, and 3 + 1 leaves an orphan. */}
      <ul data-related-grid className="mt-8 film-rows">
        {cards.map((card) => (
          <li key={card.slug} data-related-item style={{ '--r': cardRatio(card) } as CSSProperties}>
            <PromptCardView
              card={card}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
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
