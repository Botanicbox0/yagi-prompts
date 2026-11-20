'use client';
/**
 * The music composer (docs/BRAND-SOUND-STUDIO.md §4.2): one floating dock under the list.
 *  SS2: a description, the vocal switch, one filled button with the credits it takes, example descriptions
 *       for a brand that has made nothing yet, and a line saying the length is fitted afterwards.
 *  SS3: with vocals, a lyrics field (written by hand, or a free first draft to edit), the language note, and
 *       "더 고르게 만들기" (twice the credits; hidden when the server setting is off). The customer never picks
 *       a "way": lyrics or the switch make it a custom request on the server.
 *  SA1: the music Prompt Architect (§12.2), as in the image studio: a switch that stays on, "지금 설계하기"
 *       (free) that opens the design in the dock to read and edit, and "원래 문장으로". A design shown when
 *       만들기 is pressed is sent as it is; otherwise the server designs the same way before sending. Any
 *       change to the description, vocals, lyrics or the switch puts the design away (it no longer matches).
 *
 * Names of real singers are caught here before a press, in the description and in the lyrics (the server
 * checks again and refuses before reserving).
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatCredits } from '@/lib/brand-studio/credits';
import { defaultStructure, LYRICS_LIMITS, markLyrics, musicWay, ownLyrics, type LyricStructure } from '@/lib/brand-studio/sound/lyrics';
import { MUSIC_LIMITS, musicQuoteCredits } from '@/lib/brand-studio/sound/music-limits';
import { namedArtist } from '@/lib/brand-studio/sound/names';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import { LyricsOptions, mustIncludeWords, PolishCompare, type LyricsOptionsValue } from './lyrics-kit';
import s from './sound.module.css';

export interface ComposerHandle {
  /** "비슷하게 만들기": the same settings back in the dock (description, vocals, lyrics, switch), focused. */
  fill(settings: { prompt: string; vocal: boolean; lyrics?: string | null; careful?: boolean }): void;
  /**
   * "다르게 설계하기" (SA3, §12.5): a refused run's settings back in the dock with the Architect on, and a new design
   * that avoids what may have been refused, shown for the customer to read before pressing again. Lyrics unchanged.
   */
  redesign(settings: { prompt: string; vocal: boolean; lyrics?: string | null; careful?: boolean }): void;
}

export interface ComposerInput {
  prompt: string;
  vocal: boolean;
  lyrics: string;
  careful: boolean;
  /** The Prompt Architect switch. */
  architect: boolean;
  /** The design the customer read (and may have edited) in the dock. */
  designed?: { style: string; title?: string };
  /** SA2: the order of the section marks (lyrics only). */
  structure: LyricStructure;
  /** SA2: the lyrics came from a draft or a polish, and that model. */
  lyricsBy?: { flow: 'topic' | 'polish'; model: string };
  /** SA2: the length the lyrics were sized for (the closest version is shown first). */
  targetSeconds: number;
}

/** What "가사 초안 만들기" and "부르기 좋게 손보기" ask for (§12.3). */
export interface LyricsDraftRequest {
  flow: 'topic' | 'polish';
  topic: string;
  lyrics?: string;
  language: 'ko' | 'en' | 'mixed';
  seconds: number;
  structure: LyricStructure;
  tone?: 'haeyo' | 'banmal';
  brand?: { name: string; readAs?: string };
  mustInclude?: string[];
}

export interface ComposerDesign {
  mode: 'describe' | 'custom';
  style: string;
  title: string;
  notes: string | null;
  source: 'model' | 'fallback';
}

const EXAMPLES = ['skincare', 'fashion', 'shortform', 'launch'] as const;

export const MusicComposer = forwardRef<
  ComposerHandle,
  {
    copy: StudioSoundCopy;
    locale: 'ko' | 'en';
    /** `{n} 크레딧` (brandStudio.credits.amount). */
    amountTemplate: string;
    busy: boolean;
    /** Example descriptions, for a brand that has made no music yet (the first minute, §4.2). */
    showExamples: boolean;
    /** "더 고르게 만들기" is offered (server setting `BRAND_SOUND_MAX_MODE=on`; hidden by default). */
    maxMode: boolean;
    error: string | null;
    onCreate: (input: ComposerInput) => void;
    onClearError: () => void;
    /** Free: a draft from the description, or the customer's lyrics polished; resolves to the lyrics or a line to show. */
    onDraft: (request: LyricsDraftRequest) => Promise<{ lyrics: string; model: string } | { error: string }>;
    /** "지금 설계하기": the free design preview; resolves to the design or a line to show. */
    onDesign: (input: Pick<ComposerInput, 'prompt' | 'vocal' | 'lyrics' | 'careful' | 'structure'> & { avoid?: boolean }) => Promise<{ design: ComposerDesign } | { error: string }>;
  }
>(function MusicComposer(props, ref) {
  const { copy } = props;
  const [prompt, setPrompt] = useState('');
  const [vocal, setVocal] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [careful, setCareful] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [architect, setArchitect] = useState(true);
  const [design, setDesign] = useState<ComposerDesign | null>(null);
  const [designing, setDesigning] = useState(false);
  const designingRef = useRef(false);
  designingRef.current = designing;
  const [options, setOptions] = useState<LyricsOptionsValue>(() => ({
    seconds: 30,
    structure: defaultStructure(30),
    tone: null,
    language: props.locale,
    brandName: '',
    readAs: '',
    mustInclude: '',
  }));
  const [structurePicked, setStructurePicked] = useState(false);
  const [lyricsBy, setLyricsBy] = useState<{ flow: 'topic' | 'polish'; model: string } | null>(null);
  const [polish, setPolish] = useState<{ lyrics: string; model: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();
  const errorId = useId();
  const lyricsNoteId = useId();

  useImperativeHandle(ref, () => ({
    redesign(settings) {
      const prompt = settings.prompt.slice(0, MUSIC_LIMITS.promptMax);
      const sung = settings.vocal && (settings.lyrics ?? '').trim() ? ownLyrics(settings.lyrics) : '';
      this.fill(settings);
      setArchitect(true);
      setDesigning(true);
      void props
        .onDesign({ prompt: prompt.trim(), vocal: settings.vocal, lyrics: sung, careful: props.maxMode && settings.careful === true, structure: options.structure, avoid: true })
        .then((answer) => {
          setDesigning(false);
          if ('design' in answer) setDesign(answer.design);
          else setLocalError(answer.error);
        });
    },
    fill(settings) {
      setPrompt(settings.prompt.slice(0, MUSIC_LIMITS.promptMax));
      setVocal(settings.vocal);
      setLyrics((settings.lyrics ?? '').slice(0, LYRICS_LIMITS.max));
      setCareful(props.maxMode && settings.careful === true);
      setDrafted(false);
      setLyricsBy(null);
      setPolish(null);
      setLocalError(null);
      requestAnimationFrame(() => field.current?.focus());
    },
  }));

  const error = localError ?? props.error;
  const trimmed = prompt.trim();
  // The customer's lyrics as written (only line endings and outer blank lines normalized): what is sent and previewed.
  const sentLyrics = vocal && lyrics.trim() ? ownLyrics(lyrics) : '';
  const switchOn = props.maxMode && careful;
  const credits = musicQuoteCredits({ mode: musicWay({ vocal, lyrics: sentLyrics, careful: switchOn }), careful: switchOn });
  const creditsText = formatCredits(credits, props.locale);

  // A design belongs to the settings it was made from: changing them puts it away (a redesign that is still
  // arriving is kept: it was asked for these settings).
  useEffect(() => {
    if (!designingRef.current) setDesign(null);
  }, [prompt, vocal, sentLyrics, switchOn, architect]);

  const clearErrors = () => {
    if (localError) setLocalError(null);
    if (props.error) props.onClearError();
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || props.busy) return;
    if (namedArtist(trimmed)) return setLocalError(copy.errors.artist);
    if (sentLyrics && namedArtist(sentLyrics)) return setLocalError(copy.composer.lyricsBlocked);
    props.onCreate({
      prompt: trimmed,
      vocal,
      lyrics: sentLyrics,
      careful: switchOn,
      architect,
      structure: options.structure,
      targetSeconds: options.seconds,
      ...(sentLyrics && lyricsBy ? { lyricsBy } : {}),
      ...(architect && design ? { designed: { style: design.style, ...(design.mode === 'custom' ? { title: design.title } : {}) } } : {}),
    });
  };
  const designNow = async () => {
    if (!trimmed || designing) return;
    if (namedArtist(trimmed)) return setLocalError(copy.errors.artist);
    if (sentLyrics && namedArtist(sentLyrics)) return setLocalError(copy.composer.lyricsBlocked);
    setDesigning(true);
    clearErrors();
    const answer = await props.onDesign({ prompt: trimmed, vocal, lyrics: sentLyrics, careful: switchOn, structure: options.structure });
    setDesigning(false);
    if ('design' in answer) setDesign(answer.design);
    else setLocalError(answer.error);
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  };
  const draftRequest = (flow: 'topic' | 'polish'): LyricsDraftRequest => {
    const brandName = options.brandName.trim();
    const words = mustIncludeWords(options.mustInclude);
    return {
      flow,
      topic: trimmed,
      ...(flow === 'polish' ? { lyrics: sentLyrics } : {}),
      language: options.language,
      seconds: options.seconds,
      structure: options.structure,
      ...(options.tone ? { tone: options.tone } : {}),
      ...(brandName ? { brand: { name: brandName, ...(options.readAs.trim() ? { readAs: options.readAs.trim() } : {}) } } : {}),
      ...(words.length ? { mustInclude: words } : {}),
    };
  };
  const optionWords = () => [options.brandName, options.readAs, options.mustInclude].join(' ');
  const draft = async () => {
    if (!trimmed || drafting) return;
    if (namedArtist(trimmed) || namedArtist(optionWords())) return setLocalError(copy.errors.artist);
    setDrafting(true);
    clearErrors();
    const answer = await props.onDraft(draftRequest('topic'));
    setDrafting(false);
    if ('lyrics' in answer) {
      setLyrics(answer.lyrics.slice(0, LYRICS_LIMITS.max));
      setLyricsBy({ flow: 'topic', model: answer.model });
      setPolish(null);
      setDrafted(true);
    } else setLocalError(answer.error);
  };
  const polishNow = async () => {
    if (!sentLyrics || polishing) return;
    if (namedArtist(sentLyrics) || namedArtist(optionWords())) return setLocalError(copy.composer.lyricsBlocked);
    setPolishing(true);
    clearErrors();
    const answer = await props.onDraft(draftRequest('polish'));
    setPolishing(false);
    if ('lyrics' in answer) setPolish({ lyrics: answer.lyrics.slice(0, LYRICS_LIMITS.max), model: answer.model });
    else setLocalError(answer.error);
  };
  const sentPreview = sentLyrics ? markLyrics(sentLyrics, options.structure) : '';

  return (
    <form className={s.dock} onSubmit={submit} data-sound-composer aria-busy={props.busy}>
      {props.showExamples && trimmed === '' ? (
        <div className={s.examples} role="group" aria-label={copy.examples.label} data-sound-examples>
          {EXAMPLES.map((key) => (
            <button
              key={key}
              type="button"
              className={s.example}
              onClick={() => {
                setPrompt(copy.examples[key]);
                clearErrors();
              }}
              data-sound-example={key}
            >
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
          onChange={(event) => {
            setPrompt(event.target.value.slice(0, MUSIC_LIMITS.promptMax));
            clearErrors();
          }}
          onKeyDown={onKey}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          aria-invalid={error ? true : undefined}
          data-sound-prompt
        />
      </label>
      {vocal ? (
        <div className={s.lyricsBox} data-sound-lyrics-box>
          <div className={s.lyricsHead}>
            <span className={s.lyricsLabel}>{copy.composer.lyrics}</span>
            <span className={s.lyricsNote} id={lyricsNoteId}>
              {drafted ? copy.composer.draftNote : sentLyrics ? copy.lyricsKit.ownNote : copy.composer.lyricsLanguage}
            </span>
            <span className={s.lyricsCount} aria-hidden="true">
              {lyrics.length}/{LYRICS_LIMITS.max}
            </span>
            <button type="button" className={s.textBtn} onClick={() => void draft()} disabled={!trimmed || drafting} data-sound-draft>
              {drafting ? copy.composer.drafting : copy.composer.draft}
            </button>
            {sentLyrics ? (
              <button
                type="button"
                className={s.textBtn}
                onClick={() => void polishNow()}
                disabled={polishing}
                title={copy.lyricsKit.polishNote}
                data-sound-polish-now
              >
                {polishing ? copy.lyricsKit.polishing : copy.lyricsKit.polish}
              </button>
            ) : null}
          </div>
          <LyricsOptions
            copy={copy}
            value={options}
            onChange={(next) => {
              const pickedNow = next.structure !== options.structure;
              if (pickedNow) setStructurePicked(true);
              setOptions(!structurePicked && !pickedNow && next.seconds !== options.seconds ? { ...next, structure: defaultStructure(next.seconds) } : next);
            }}
          />
          <label className={s.well}>
            <span className="bs-sr">{copy.composer.lyrics}</span>
            <textarea
              value={lyrics}
              rows={4}
              maxLength={LYRICS_LIMITS.max}
              placeholder={copy.composer.lyricsPlaceholder}
              onChange={(event) => {
                const next = event.target.value.slice(0, LYRICS_LIMITS.max);
                setLyrics(next);
                if (!next.trim()) setLyricsBy(null);
                setPolish(null);
                setDrafted(false);
                clearErrors();
              }}
              aria-describedby={lyricsNoteId}
              className={s.lyricsField}
              data-sound-lyrics
            />
          </label>
          {polish ? (
            <PolishCompare
              copy={copy}
              current={sentLyrics}
              polished={polish.lyrics}
              onKeep={() => setPolish(null)}
              onAccept={() => {
                setLyrics(polish.lyrics);
                setLyricsBy({ flow: 'polish', model: polish.model });
                setPolish(null);
              }}
            />
          ) : null}
          {sentLyrics ? (
            <div className={s.sent} data-sound-lyrics-sent={showSent ? 'open' : 'closed'}>
              <button type="button" className={s.textBtn} onClick={() => setShowSent((v) => !v)} aria-expanded={showSent} data-sound-lyrics-sent-toggle>
                {showSent ? copy.lyricsKit.previewHide : copy.lyricsKit.previewShow}
              </button>
              {showSent ? (
                <pre className={s.lyricsPre} aria-label={copy.lyricsKit.preview} data-sound-lyrics-sent-text>
                  {sentPreview}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {design ? (
        <div className={s.designBox} data-sound-design={design.source}>
          <div className={s.lyricsHead}>
            <span className={s.lyricsLabel}>{copy.architect.styleLabel}</span>
            <span className={s.lyricsNote}>{design.source === 'model' ? (design.notes ?? copy.architect.designed) : copy.architect.fallbackNote}</span>
            <button type="button" className={s.textBtn} onClick={() => setDesign(null)} data-sound-design-undo>
              {copy.architect.undo}
            </button>
          </div>
          <label className={s.well}>
            <span className="bs-sr">{copy.architect.styleLabel}</span>
            <textarea
              value={design.style}
              rows={3}
              maxLength={1000}
              onChange={(event) => setDesign({ ...design, style: event.target.value.slice(0, 1000) })}
              className={s.designField}
              data-sound-design-style
            />
          </label>
          {design.mode === 'custom' ? (
            <label className={s.titleRow}>
              <span className={s.lyricsLabel}>{copy.architect.titleLabel}</span>
              <input
                value={design.title}
                maxLength={80}
                onChange={(event) => setDesign({ ...design, title: event.target.value.slice(0, 80) })}
                className={s.titleField}
                data-sound-design-title
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className={s.dockBar}>
        <button
          type="button"
          role="switch"
          aria-checked={architect}
          className={s.switch}
          onClick={() => setArchitect((v) => !v)}
          title={`${copy.architect.tip} ${copy.architect.free}`}
          data-sound-architect={architect ? 'on' : 'off'}
        >
          <span className={s.switchTrack} aria-hidden="true">
            <span className={s.switchKnob} />
          </span>
          {copy.architect.name}
        </button>
        {architect ? (
          <button type="button" className={s.textBtn} onClick={() => void designNow()} disabled={!trimmed || designing} data-sound-design-now>
            {designing ? copy.architect.designing : copy.architect.designNow}
          </button>
        ) : null}
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
        {props.maxMode ? (
          <button
            type="button"
            role="switch"
            aria-checked={careful}
            className={s.switch}
            onClick={() => setCareful((v) => !v)}
            title={copy.composer.carefulNote}
            data-sound-careful={careful ? 'on' : 'off'}
          >
            <span className={s.switchTrack} aria-hidden="true">
              <span className={s.switchKnob} />
            </span>
            {copy.composer.careful}
          </button>
        ) : null}
        <p id={hintId} className={s.dockNote}>
          {switchOn ? copy.composer.carefulNote : copy.composer.lengthNote}
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
