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
import { defaultStructure, LYRICS_LIMITS, markLyrics, musicWay, ownLyrics, tempoOf, type LyricStructure } from '@/lib/brand-studio/sound/lyrics';
import { draftStanzaLines, lengthPlan, LONG_RATIO, runTempo, sungPlan } from '@/lib/brand-studio/sound/length-plan';
import { MUSIC_LIMITS, musicQuoteCredits } from '@/lib/brand-studio/sound/music-limits';
import { namedArtist } from '@/lib/brand-studio/sound/names';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import { LyricsOptions, mustIncludeWords, PolishCompare, targetOf, type LyricsOptionsValue, type LyricsVideo } from './lyrics-kit';
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
  /** SA4: the library video the music is fitted to. */
  videoAssetId?: string;
  /** Sung with no lyrics: the brand and words to include from the lyrics options, sent with the request. */
  words?: ComposerWords;
  /** The tempo a draft was planned at (§12.11), sent with its lyrics so the run and the design keep it. */
  bpm?: number;
}

export interface ComposerWords {
  brand?: { name: string; readAs?: string };
  mustInclude?: string[];
}

/** What "가사 초안 만들기" and "부르기 좋게 손보기" ask for (§12.3). */
export interface LyricsDraftRequest {
  videoAssetId?: string;
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

/** The plan a draft would get for this description, structure and length (before there are lyrics). */
function draftView(description: string, structure: LyricStructure, seconds: number) {
  const bpm = runTempo({ description, wordsBpm: tempoOf(description) });
  return lengthPlan({ seconds, bpm, structure, stanzas: draftStanzaLines(structure, seconds, bpm), repeatHook: true });
}

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
    onDraft: (request: LyricsDraftRequest) => Promise<{ lyrics: string; model: string; bpm?: number } | { error: string }>;
    /** SA4: library videos "영상 길이" can fit the lyrics and the design to. */
    videos?: readonly LyricsVideo[];
    /** "지금 설계하기": the free design preview; resolves to the design or a line to show. */
    onDesign: (
      input: Pick<ComposerInput, 'prompt' | 'vocal' | 'lyrics' | 'careful' | 'structure' | 'videoAssetId' | 'words' | 'targetSeconds' | 'bpm' | 'lyricsBy'> & { avoid?: boolean },
    ) => Promise<{ design: ComposerDesign } | { error: string }>;
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
  /** A design asked for from the next render (after "다르게 설계하기" filled the dock, or after the lyrics were drafted first). */
  const [designAsked, setDesignAsked] = useState<{ avoid: boolean } | null>(null);
  /** The lyrics were drafted because 만들기 was pressed with vocals and none written: read them, then press again. */
  const [firstDraft, setFirstDraft] = useState(false);
  /** A draft past a few seconds shows a live line (real run: 15 to 20 seconds are common). */
  const [slowDraft, setSlowDraft] = useState(false);
  const [options, setOptions] = useState<LyricsOptionsValue>(() => ({
    seconds: 30,
    video: null,
    structure: defaultStructure(30),
    tone: null,
    language: props.locale,
    brandName: '',
    readAs: '',
    mustInclude: '',
  }));
  const [structurePicked, setStructurePicked] = useState(false);
  const [lyricsBy, setLyricsBy] = useState<{ flow: 'topic' | 'polish'; model: string } | null>(null);
  /** The tempo the drafted lyrics were planned at; kept while there are lyrics in the box. */
  const [draftBpm, setDraftBpm] = useState<number | null>(null);
  const [polish, setPolish] = useState<{ lyrics: string; model: string; bpm?: number } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();
  const errorId = useId();
  const lyricsNoteId = useId();

  useImperativeHandle(ref, () => ({
    redesign(settings) {
      // The settings land first; the design is asked for from the next render, so its inputs are the filled ones.
      this.fill(settings);
      setArchitect(true);
      setDesignAsked({ avoid: true });
    },
    fill(settings) {
      setPrompt(settings.prompt.slice(0, MUSIC_LIMITS.promptMax));
      setVocal(settings.vocal);
      setLyrics((settings.lyrics ?? '').slice(0, LYRICS_LIMITS.max));
      setCareful(props.maxMode && settings.careful === true);
      setDrafted(false);
      setFirstDraft(false);
      setLyricsBy(null);
      setDraftBpm(null);
      setPolish(null);
      setLocalError(null);
      requestAnimationFrame(() => field.current?.focus());
    },
  }));

  const error = localError ?? props.error;
  const trimmed = prompt.trim();
  // The customer's lyrics as written (only line endings and outer blank lines normalized): what is sent and previewed.
  const sentLyrics = vocal && lyrics.trim() ? ownLyrics(lyrics) : '';
  // SA4: the picked video (lyrics with vocals only: the option sits with the lyrics).
  const videoId = vocal && options.seconds === 'video' ? options.video?.assetId : undefined;
  const switchOn = props.maxMode && careful;
  // Sung with nothing written and the Architect on: the lyrics are drafted first, so the customer reads them before
  // anything is spent (real run of 2026-11-21: without lyrics the brand and the message never reached the engine).
  const lyricsFirst = vocal && !sentLyrics && architect;
  const brandName = options.brandName.trim();
  const words: ComposerWords | undefined = (() => {
    if (!vocal || sentLyrics) return undefined;
    const must = mustIncludeWords(options.mustInclude);
    if (!brandName && !must.length) return undefined;
    return {
      ...(brandName ? { brand: { name: brandName, ...(options.readAs.trim() ? { readAs: options.readAs.trim() } : {}) } } : {}),
      ...(must.length ? { mustInclude: must } : {}),
    };
  })();
  // The length plan (§12.11), the same function the server runs: the form "보낼 가사 보기" shows, and whether the
  // customer's own lines can fill the length.
  const plan = sungPlan({
    prompt: trimmed,
    vocal,
    lyrics: sentLyrics,
    structure: options.structure,
    seconds: targetOf(options),
    draftBpm,
    drafted: lyricsBy?.flow === 'topic',
  });
  const sentBpm = sentLyrics && draftBpm ? draftBpm : undefined;
  const credits = musicQuoteCredits({ mode: musicWay({ vocal, lyrics: sentLyrics, careful: switchOn }), careful: switchOn });
  const creditsText = formatCredits(credits, props.locale);

  // A design belongs to the settings it was made from: description, vocals, lyrics, structure, video, language and
  // the switches. Changing any of them puts it away, and an answer asked for other settings is dropped on arrival.
  const designKey = JSON.stringify([trimmed, vocal, sentLyrics, options.structure, videoId ?? null, options.language, switchOn, architect]);
  const designKeyRef = useRef(designKey);
  designKeyRef.current = designKey;
  useEffect(() => {
    setDesign(null);
  }, [designKey]);

  const clearErrors = () => {
    if (localError) setLocalError(null);
    if (props.error) props.onClearError();
  };
  const create = () => {
    setFirstDraft(false);
    props.onCreate({
      prompt: trimmed,
      vocal,
      lyrics: sentLyrics,
      careful: switchOn,
      architect,
      structure: options.structure,
      targetSeconds: targetOf(options),
      ...(videoId ? { videoAssetId: videoId } : {}),
      ...(sentLyrics && lyricsBy ? { lyricsBy } : {}),
      ...(words ? { words } : {}),
      ...(sentBpm ? { bpm: sentBpm } : {}),
      ...(architect && design ? { designed: { style: design.style, title: design.title } } : {}),
    });
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || props.busy || drafting) return;
    if (namedArtist(trimmed)) return setLocalError(copy.errors.artist);
    if (sentLyrics && namedArtist(sentLyrics)) return setLocalError(copy.composer.lyricsBlocked);
    // A name in the brand or the words to include stops here, as it would stop the draft and the run.
    if (vocal && !sentLyrics && namedArtist(optionWords())) return setLocalError(copy.errors.artist);
    if (lyricsFirst) {
      // Drafted: shown in the box, nothing made until 만들기 is pressed again. Not drafted (busy, failed): the run
      // goes as asked, and the request carries what the song is about (lib/brand-studio/sound/architect.ts).
      void draft(true).then((ok) => {
        if (ok) setFirstDraft(true);
        else create();
      });
      return;
    }
    create();
  };
  const designNow = async (avoid = false) => {
    if (!trimmed || designing) return;
    if (namedArtist(trimmed)) return setLocalError(copy.errors.artist);
    if (sentLyrics && namedArtist(sentLyrics)) return setLocalError(copy.composer.lyricsBlocked);
    if (vocal && !sentLyrics && namedArtist(optionWords())) return setLocalError(copy.errors.artist);
    if (lyricsFirst) {
      // The design is made for the lyrics, so they come first; it is asked for once they are in the box.
      setDesigning(true);
      const ok = await draft(true);
      setDesigning(false);
      if (ok) return setDesignAsked({ avoid });
    }
    const askedFor = designKeyRef.current;
    setDesigning(true);
    clearErrors();
    const answer = await props.onDesign({
      prompt: trimmed,
      vocal,
      lyrics: sentLyrics,
      careful: switchOn,
      structure: options.structure,
      ...(videoId ? { videoAssetId: videoId } : {}),
      ...(words ? { words } : {}),
      // The plan's inputs, so the preview designs for the same tempo and form the run will send.
      targetSeconds: targetOf(options),
      ...(sentBpm ? { bpm: sentBpm } : {}),
      ...(sentLyrics && lyricsBy ? { lyricsBy } : {}),
      ...(avoid ? { avoid: true } : {}),
    });
    setDesigning(false);
    // Settings changed while it was on its way: the answer no longer matches what would be sent.
    if (designKeyRef.current !== askedFor) return;
    if ('design' in answer) setDesign(answer.design);
    else setLocalError(answer.error);
  };
  // Runs once the settings it needs are in the dock ("다르게 설계하기", or lyrics drafted first).
  useEffect(() => {
    if (!designAsked) return;
    setDesignAsked(null);
    void designNow(designAsked.avoid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the request only, with this render's settings
  }, [designAsked]);
  useEffect(() => {
    if (!drafting) return setSlowDraft(false);
    const timer = setTimeout(() => setSlowDraft(true), 4000);
    return () => clearTimeout(timer);
  }, [drafting]);
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  };
  const draftRequest = (flow: 'topic' | 'polish'): LyricsDraftRequest => {
    const must = mustIncludeWords(options.mustInclude);
    return {
      flow,
      topic: trimmed,
      ...(flow === 'polish' ? { lyrics: sentLyrics } : {}),
      language: options.language,
      seconds: targetOf(options),
      ...(videoId ? { videoAssetId: videoId } : {}),
      structure: options.structure,
      ...(options.tone ? { tone: options.tone } : {}),
      ...(brandName ? { brand: { name: brandName, ...(options.readAs.trim() ? { readAs: options.readAs.trim() } : {}) } } : {}),
      ...(must.length ? { mustInclude: must } : {}),
    };
  };
  const optionWords = () => [options.brandName, options.readAs, options.mustInclude].join(' ');
  /** "가사 초안 만들기". `quiet`: drafted on the way to a run or a design, so a failure shows nothing (the run goes on). */
  const draft = async (quiet = false): Promise<boolean> => {
    if (!trimmed || drafting) return false;
    if (namedArtist(trimmed) || namedArtist(optionWords())) {
      setLocalError(copy.errors.artist);
      return false;
    }
    setDrafting(true);
    clearErrors();
    setFirstDraft(false);
    const answer = await props.onDraft(draftRequest('topic'));
    setDrafting(false);
    if ('lyrics' in answer) {
      setLyrics(answer.lyrics.slice(0, LYRICS_LIMITS.max));
      setLyricsBy({ flow: 'topic', model: answer.model });
      setDraftBpm(answer.bpm ?? null);
      setPolish(null);
      setDrafted(true);
      return true;
    }
    if (!quiet) setLocalError(answer.error);
    return false;
  };
  const polishNow = async () => {
    if (!sentLyrics || polishing) return;
    if (namedArtist(sentLyrics) || namedArtist(optionWords())) return setLocalError(copy.composer.lyricsBlocked);
    setPolishing(true);
    clearErrors();
    const answer = await props.onDraft(draftRequest('polish'));
    setPolishing(false);
    if ('lyrics' in answer) setPolish({ lyrics: answer.lyrics.slice(0, LYRICS_LIMITS.max), model: answer.model, ...(answer.bpm ? { bpm: answer.bpm } : {}) });
    else setLocalError(answer.error);
  };
  const sentPreview = sentLyrics ? markLyrics(sentLyrics, options.structure, plan?.form ?? null) : '';
  // The customer's own lines are short of the length even with sections around them: say it, never block.
  const shortNote =
    plan && !plan.enough && lyricsBy?.flow !== 'topic'
      ? interpolate(copy.lyricsKit.short, { min: String(plan.estimate.min), max: String(plan.estimate.max), target: String(plan.seconds), n: String(plan.missingLines) })
      : null;
  // A structure with more stanzas than the length needs runs long (§12.11: 15 s with two verses, 45–105 s). Before
  // there are lyrics, the plan a draft would get says it; with lyrics, their own plan. Never blocks.
  const seconds = targetOf(options);
  const lengthView =
    plan ??
    (vocal && !sentLyrics && seconds ? draftView(trimmed, options.structure, seconds) : null);
  const longNote =
    lengthView?.seconds && lengthView.estimate.max > lengthView.seconds * LONG_RATIO
      ? interpolate(copy.lyricsKit.long, { min: String(lengthView.estimate.min), max: String(lengthView.estimate.max), target: String(lengthView.seconds) })
      : null;

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
        <div className={s.lyricsBox} data-sound-lyrics-box data-busy={drafting ? '' : undefined}>
          <div className={s.lyricsHead}>
            <span className={s.lyricsLabel}>{copy.composer.lyrics}</span>
            <span className={s.lyricsNote} id={lyricsNoteId} aria-live="polite" data-sound-lyrics-note={firstDraft ? 'first' : drafting ? 'drafting' : undefined}>
              {drafting && slowDraft
                ? copy.composer.draftWait
                : firstDraft
                  ? copy.composer.lyricsFirst
                  : drafted
                    ? copy.composer.draftNote
                    : sentLyrics
                      ? copy.lyricsKit.ownNote
                      : copy.composer.lyricsLanguage}
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
            videos={props.videos ?? []}
            structureDefault={defaultStructure(targetOf(options))}
            value={options}
            onChange={(next) => {
              const pickedNow = next.structure !== options.structure;
              if (pickedNow) setStructurePicked(true);
              const lengthChanged = targetOf(next) !== targetOf(options);
              setOptions(!structurePicked && !pickedNow && lengthChanged ? { ...next, structure: defaultStructure(targetOf(next)) } : next);
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
                // An edited draft is the customer's text: the record of who wrote it goes (§12.5, review 1).
                setLyricsBy(null);
                if (!next.trim()) setDraftBpm(null);
                setPolish(null);
                setDrafted(false);
                setFirstDraft(false);
                clearErrors();
              }}
              aria-describedby={lyricsNoteId}
              className={s.lyricsField}
              data-sound-lyrics
            />
          </label>
          {shortNote ? (
            <p className={s.optionNote} role="status" data-sound-lyrics-short>
              {shortNote}
            </p>
          ) : null}
          {longNote ? (
            <p className={s.optionNote} role="status" data-sound-lyrics-long>
              {longNote}
            </p>
          ) : null}
          {polish ? (
            <PolishCompare
              copy={copy}
              current={sentLyrics}
              polished={polish.lyrics}
              onKeep={() => setPolish(null)}
              onAccept={() => {
                setLyrics(polish.lyrics);
                setLyricsBy({ flow: 'polish', model: polish.model });
                if (polish.bpm) setDraftBpm(polish.bpm);
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
          {/* The track's name in the list, in both modes (custom mode also sends it). */}
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
          {switchOn ? copy.composer.carefulNote : vocal ? copy.composer.lengthNote : copy.composer.instrumentalNote}
        </p>
        <span className={s.count} aria-hidden="true">
          {prompt.length}/{MUSIC_LIMITS.promptMax}
        </span>
        <button
          type="submit"
          className="bs-btn"
          data-variant="solid"
          data-size="md"
          disabled={!trimmed || props.busy || drafting}
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
