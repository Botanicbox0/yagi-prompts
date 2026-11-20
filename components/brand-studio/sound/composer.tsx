'use client';
/**
 * The music composer (docs/BRAND-SOUND-STUDIO.md §4.2, slice SS2): one floating dock under the list. A
 * description, the vocal switch, one filled button with the credits it takes. No length control: a line says
 * the length is fitted afterwards. Example descriptions sit above the field while it is empty.
 *
 * Names of real singers are caught here before a press (the server checks again and refuses before reserving).
 */
import { forwardRef, useId, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatCredits } from '@/lib/brand-studio/credits';
import { MUSIC_LIMITS } from '@/lib/brand-studio/sound/music-limits';
import { namedArtist } from '@/lib/brand-studio/sound/names';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import s from './sound.module.css';

export interface ComposerHandle {
  /** "비슷하게 만들기": the same settings back in the dock, focused. */
  fill(prompt: string, vocal: boolean): void;
}

const EXAMPLES = ['skincare', 'fashion', 'shortform', 'launch'] as const;

export const MusicComposer = forwardRef<
  ComposerHandle,
  {
    copy: StudioSoundCopy;
    locale: 'ko' | 'en';
    /** Credits the press takes (the server's own quote). */
    credits: number;
    /** `{n} 크레딧` (brandStudio.credits.amount). */
    amountTemplate: string;
    busy: boolean;
    /** Example descriptions, for a brand that has made no music yet (the first minute, §4.2). */
    showExamples: boolean;
    error: string | null;
    onCreate: (input: { prompt: string; vocal: boolean }) => void;
    onClearError: () => void;
  }
>(function MusicComposer(props, ref) {
  const { copy } = props;
  const [prompt, setPrompt] = useState('');
  const [vocal, setVocal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();
  const errorId = useId();

  useImperativeHandle(ref, () => ({
    fill(next, nextVocal) {
      setPrompt(next.slice(0, MUSIC_LIMITS.promptMax));
      setVocal(nextVocal);
      setLocalError(null);
      requestAnimationFrame(() => field.current?.focus());
    },
  }));

  const error = localError ?? props.error;
  const trimmed = prompt.trim();

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || props.busy) return;
    if (namedArtist(trimmed)) {
      setLocalError(copy.errors.artist);
      return;
    }
    props.onCreate({ prompt: trimmed, vocal });
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  };
  const change = (value: string) => {
    setPrompt(value.slice(0, MUSIC_LIMITS.promptMax));
    if (localError) setLocalError(null);
    if (props.error) props.onClearError();
  };
  const creditsText = formatCredits(props.credits, props.locale);

  return (
    <form className={s.dock} onSubmit={submit} data-sound-composer aria-busy={props.busy}>
      {props.showExamples && trimmed === '' ? (
        <div className={s.examples} role="group" aria-label={copy.examples.label} data-sound-examples>
          {EXAMPLES.map((key) => (
            <button key={key} type="button" className={s.example} onClick={() => change(copy.examples[key])} data-sound-example={key}>
              {copy.examples[key]}
            </button>
          ))}
        </div>
      ) : null}
      <label className={s.well}>
        <span className="bs-sr">{copy.composer.label}</span>
        <textarea
          ref={field}
          value={prompt}
          rows={2}
          maxLength={MUSIC_LIMITS.promptMax}
          placeholder={copy.composer.placeholder}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKey}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          aria-invalid={error ? true : undefined}
          data-sound-prompt
        />
      </label>
      <div className={s.dockBar}>
        <div className={s.segment} role="radiogroup" aria-label={copy.composer.vocals} data-sound-vocal={vocal ? 'on' : 'off'}>
          {([false, true] as const).map((value) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={vocal === value}
              className={s.segmentItem}
              onClick={() => setVocal(value)}
              data-sound-vocal-option={value ? 'on' : 'off'}
            >
              {value ? copy.composer.withVocals : copy.composer.noVocals}
            </button>
          ))}
        </div>
        <p id={hintId} className={s.dockNote}>
          {copy.composer.lengthNote}
        </p>
        <span className={s.count} aria-hidden="true">
          {prompt.length}/{MUSIC_LIMITS.promptMax}
        </span>
        <button
          type="submit"
          className="bs-btn"
          data-variant="solid"
          data-size="md"
          disabled={!trimmed || props.busy}
          aria-label={interpolate(copy.composer.createLabel, { credits: creditsText })}
          data-sound-create
        >
          {props.busy ? copy.composer.creating : copy.composer.create}
          <span className={s.cost} data-sound-cost>
            {interpolate(props.amountTemplate, { n: creditsText })}
          </span>
        </button>
      </div>
      {error ? (
        <p id={errorId} className={s.dockError} role="alert" data-sound-composer-error>
          {error}
        </p>
      ) : null}
    </form>
  );
});
