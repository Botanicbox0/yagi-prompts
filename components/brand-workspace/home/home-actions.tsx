'use client';
/**
 * The home's two client islands (docs/BRAND-STUDIO-V3.md §12): the prompt bar and the starters. Both only
 * hand a sentence to a studio (components/brand-studio/prefill.ts) and open it; nothing is generated and
 * nothing is spent here. Without JavaScript the bar is a plain form that opens the chosen studio.
 */
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { writeStudioPrefill } from '@/components/brand-studio/prefill';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import type { HomeDoorKey } from '@/lib/brands/workspace/home';
import s from './home.module.css';

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Leaves the sentence for the studio, then opens it. */
function openStudio(href: string, organizationId: string, medium: HomeDoorKey, prompt: string) {
  writeStudioPrefill(storage(), { organizationId, medium, prompt });
  window.location.assign(href);
}

const Arrow = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="bs-icon">
    <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
  </svg>
);

export interface HomePromptCopy {
  label: string;
  placeholder: Record<HomeDoorKey, string>;
  medium: Record<HomeDoorKey, string>;
  mediumLabel: string;
  button: string;
  hint: string;
}

export function HomePrompt({
  organizationId,
  hrefs,
  copy,
}: {
  organizationId: string;
  hrefs: Record<HomeDoorKey, string>;
  copy: HomePromptCopy;
}) {
  const [medium, setMedium] = useState<HomeDoorKey>('image');
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const go = () => openStudio(hrefs[medium], organizationId, medium, text);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go();
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter opens the studio; Shift+Enter is a new line; a Korean word still being composed is left alone.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      go();
    }
  };
  return (
    <form
      className={`bs-dock ${s.prompt}`}
      action={hrefs[medium].split('?')[0]}
      method="get"
      onSubmit={submit}
      data-home-prompt
      data-medium={medium}
      onClick={(event) => {
        // The whole surface is the field's: a click on its empty part puts the caret in it.
        if (event.target === event.currentTarget) field.current?.focus();
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <label className={s.srOnly} htmlFor="home-prompt-field">
        {copy.label}
      </label>
      <textarea
        ref={field}
        id="home-prompt-field"
        className={s.promptField}
        rows={2}
        maxLength={STUDIO_LIMITS.promptMax}
        placeholder={copy.placeholder[medium]}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keys}
        data-home-prompt-field
      />
      <div className={`bs-controls ${s.promptControls}`}>
        <div className="bs-controls-set">
          <fieldset className="bs-seg" data-home-medium>
            <legend className="bs-sr">{copy.mediumLabel}</legend>
            {(['image', 'video'] as const).map((value) => (
              <label key={value} className="bs-seg-option">
                <input type="radio" name="medium" value={value} checked={medium === value} onChange={() => setMedium(value)} />
                <span>{copy.medium[value]}</span>
              </label>
            ))}
          </fieldset>
          <p className={s.promptHint}>{copy.hint}</p>
        </div>
        <div className="bs-controls-end">
          <button type="submit" className="bs-btn" data-variant="solid" data-size="md" data-home-prompt-submit>
            <span>{copy.button}</span>
            <Arrow />
          </button>
        </div>
      </div>
    </form>
  );
}

export interface HomeStarter {
  key: string;
  medium: HomeDoorKey;
  picture: string;
  name: string;
  prompt: string;
}

/** One starter: a house frame and the sentence that describes it, opened in its studio with that sentence. */
export function HomeStarterButton({
  starter,
  organizationId,
  href,
  mediumLabel,
  actionLabel,
}: {
  starter: HomeStarter;
  organizationId: string;
  href: string;
  mediumLabel: string;
  /** The prompt bar's own button words: what pressing the card does. */
  actionLabel: string;
}) {
  return (
    <a
      href={href}
      className={s.starter}
      data-home-starter={starter.key}
      data-medium={starter.medium}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        openStudio(href, organizationId, starter.medium, starter.prompt);
      }}
    >
      <span className={s.starterPicture}>
        {/* A house frame the brand host already serves (lib/brands/workspace/home.ts HOME_STARTERS). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={starter.picture} alt="" loading="lazy" decoding="async" />
      </span>
      <span className={s.starterText}>
        <span className={s.starterMeta}>{mediumLabel}</span>
        <span className={s.starterName}>{starter.name}</span>
        <span className={s.starterPrompt}>{starter.prompt}</span>
        <span className={s.starterAction} aria-hidden="true">
          {actionLabel}
          <Arrow />
        </span>
      </span>
    </a>
  );
}
