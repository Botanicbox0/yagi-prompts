'use client';

/**
 * The lyrics options of the music dock (docs/BRAND-SOUND-STUDIO.md §12.3, SA2): length, structure, tone, language,
 * the brand name with its Korean reading, and words to include. They size and shape a draft or a polish, and the
 * structure decides the order of the section marks the request carries. Marks are never typed or picked by the
 * customer; "보낼 가사 보기" shows the lyrics exactly as they will be sent.
 *
 * Also here: the side-by-side "부르기 좋게 손보기" result (nothing changes unless the customer accepts it).
 */
import { useEffect, useId, useState } from 'react';
import { LYRIC_LENGTHS, LYRIC_STRUCTURES, type LyricStructure } from '@/lib/brand-studio/sound/lyrics';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import s from './sound.module.css';

export type LyricsLanguage = 'ko' | 'en' | 'mixed';
export type LyricsTone = 'haeyo' | 'banmal';

/** A library video "영상 길이" can fit the lyrics to (SA4). */
export interface LyricsVideo {
  assetId: string;
  name: string;
  seconds: number;
}

export interface LyricsOptionsValue {
  /** A fixed length, or `video`: the picked video's length. */
  seconds: (typeof LYRIC_LENGTHS)[number] | 'video';
  video: LyricsVideo | null;
  structure: LyricStructure;
  tone: LyricsTone | null;
  language: LyricsLanguage;
  brandName: string;
  readAs: string;
  mustInclude: string;
}

/** "꼭 넣을 말": comma separated, at most five words of 40 characters. */
export function mustIncludeWords(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((word) => word.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 5);
}

function Segment<T extends string | number>(props: {
  label: string;
  options: readonly T[];
  value: T | null;
  name: (value: T) => string;
  onChange: (value: T | null) => void;
  /** A second press on the chosen option clears it (tone: "pick one for me"). */
  clearable?: boolean;
  data: string;
}) {
  const labelId = useId();
  return (
    <div className={s.option}>
      <span className={s.optionLabel} id={labelId}>
        {props.label}
      </span>
      <div className={s.segment} role="radiogroup" aria-labelledby={labelId} data-sound-lyrics-option={props.data}>
        {props.options.map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={props.value === option}
            className={s.segmentItem}
            onClick={() => props.onChange(props.clearable && props.value === option ? null : option)}
            data-sound-lyrics-value={String(option)}
          >
            {props.name(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The target the lyrics are sized for: a fixed length, or the picked video's (whole seconds). */
export function targetOf(value: Pick<LyricsOptionsValue, 'seconds' | 'video'>): number {
  if (value.seconds === 'video') return value.video ? Math.min(240, Math.max(5, Math.round(value.video.seconds))) : 30;
  return value.seconds;
}

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const MORE_KEY = 'twings.sound.lyricsMoreOpen';

function readMoreOpen(): boolean {
  try {
    return window.localStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMoreOpen(open: boolean): void {
  try {
    window.localStorage.setItem(MORE_KEY, open ? '1' : '0');
  } catch {
    // Private windows and blocked storage: the panel just starts closed next time.
  }
}

/** How many of the folded options are set (the structure counts when it is not the length's default). */
export function foldedSetCount(value: LyricsOptionsValue, structureDefault: LyricStructure): number {
  return [
    value.structure !== structureDefault,
    value.tone != null,
    value.brandName.trim() !== '',
    value.readAs.trim() !== '',
    value.mustInclude.trim() !== '',
  ].filter(Boolean).length;
}

export function LyricsOptions(props: {
  copy: StudioSoundCopy;
  value: LyricsOptionsValue;
  onChange: (next: LyricsOptionsValue) => void;
  /** SA4: the library videos "영상 길이" offers; the option is hidden when there are none. */
  videos: readonly LyricsVideo[];
  /** The structure the current length starts with: a different one counts as set. */
  structureDefault: LyricStructure;
}) {
  const { copy, value } = props;
  const k = copy.lyricsKit;
  const set = <K extends keyof LyricsOptionsValue>(key: K, next: LyricsOptionsValue[K]) => props.onChange({ ...value, [key]: next });
  // Length and language stay in view; the rest folds behind one quiet disclosure, closed by default and remembered
  // per browser (review 1: the open options read as a form to fill in).
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(readMoreOpen()), []);
  const moreId = useId();
  const setCount = foldedSetCount(value, props.structureDefault);
  return (
    <div className={s.lyricsOptions} role="group" aria-label={k.options} data-sound-lyrics-options>
      <div className={s.optionRow}>
        <Segment<(typeof LYRIC_LENGTHS)[number] | 'video'>
          label={k.length}
          options={props.videos.length ? [...LYRIC_LENGTHS, 'video'] : LYRIC_LENGTHS}
          value={value.seconds}
          name={(n) => (n === 'video' ? k.videoLength : interpolate(k.seconds, { n: String(n) }))}
          onChange={(n) => {
            if (n == null) return;
            props.onChange({ ...value, seconds: n, video: n === 'video' ? (value.video ?? props.videos[0] ?? null) : null });
          }}
          data="seconds"
        />
        <Segment
          label={k.language}
          options={['ko', 'en', 'mixed'] as const}
          value={value.language}
          name={(key) => k.languages[key]}
          onChange={(key) => key != null && set('language', key)}
          data="language"
        />
        <button
          type="button"
          className={s.moreToggle}
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => {
            const next = !moreOpen;
            setMoreOpen(next);
            writeMoreOpen(next);
          }}
          data-sound-lyrics-more={moreOpen ? 'open' : 'closed'}
        >
          {k.more}
          {setCount > 0 ? (
            <span className={s.moreCount} aria-label={interpolate(k.moreSet, { n: String(setCount) })} data-sound-lyrics-more-count={setCount}>
              {setCount}
            </span>
          ) : null}
          <span className={s.moreChevron} aria-hidden="true" data-open={moreOpen ? '' : undefined} />
        </button>
      </div>
      {value.seconds === 'video' && props.videos.length ? (
        <div className={s.videoPick} role="radiogroup" aria-label={k.videoPick} data-sound-video-pick>
          {props.videos.map((video) => (
            <button
              key={video.assetId}
              type="button"
              role="radio"
              aria-checked={value.video?.assetId === video.assetId}
              className={s.videoChip}
              onClick={() => props.onChange({ ...value, video })}
              data-sound-video={video.assetId}
            >
              <span className={s.videoName}>{video.name}</span>
              <span className={s.videoTime}>{clock(video.seconds)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {moreOpen ? (
        <div className={s.moreBody} id={moreId} data-sound-lyrics-more-body>
          <div className={s.optionRow}>
            <Segment
              label={k.structure}
              options={LYRIC_STRUCTURES}
              value={value.structure}
              name={(key) => k.structures[key]}
              onChange={(key) => key != null && set('structure', key)}
              data="structure"
            />
            <Segment
              label={k.tone}
              options={['haeyo', 'banmal'] as const}
              value={value.tone}
              name={(key) => k.tones[key]}
              onChange={(key) => set('tone', key)}
              clearable
              data="tone"
            />
          </div>
          <div className={s.fieldRow}>
            <label className={s.optionField}>
              <span className={s.optionLabel}>{k.brand}</span>
              <input value={value.brandName} maxLength={60} onChange={(e) => set('brandName', e.target.value.slice(0, 60))} className={s.titleField} data-sound-lyrics-brand />
            </label>
            <label className={s.optionField}>
              <span className={s.optionLabel}>{k.readAs}</span>
              <input
                value={value.readAs}
                maxLength={60}
                placeholder={k.readAsExample}
                onChange={(e) => set('readAs', e.target.value.slice(0, 60))}
                className={s.titleField}
                data-sound-lyrics-read-as
              />
            </label>
            <label className={s.optionField}>
              <span className={s.optionLabel}>{k.mustInclude}</span>
              <input
                value={value.mustInclude}
                maxLength={220}
                placeholder={k.mustIncludeHint}
                onChange={(e) => set('mustInclude', e.target.value.slice(0, 220))}
                className={s.titleField}
                data-sound-lyrics-must
              />
            </label>
          </div>
        </div>
      ) : null}
      <p className={s.optionNote}>{k.lengthNote}</p>
    </div>
  );
}

/** "부르기 좋게 손보기": the customer's lyrics and the polished ones side by side. */
export function PolishCompare(props: { copy: StudioSoundCopy; current: string; polished: string; onAccept: () => void; onKeep: () => void }) {
  const k = props.copy.lyricsKit;
  return (
    <div className={s.compare} data-sound-polish>
      <div className={s.compareCol}>
        <span className={s.lyricsLabel}>{k.current}</span>
        <pre className={s.lyricsPre} data-sound-polish-current>
          {props.current}
        </pre>
      </div>
      <div className={s.compareCol}>
        <span className={s.lyricsLabel}>{k.polished}</span>
        <pre className={s.lyricsPre} data-sound-polish-new>
          {props.polished}
        </pre>
      </div>
      <div className={s.compareBar}>
        <span className={s.lyricsNote}>{k.polishNote}</span>
        <button type="button" className={s.textBtn} onClick={props.onKeep} data-sound-polish-keep>
          {k.keep}
        </button>
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={props.onAccept} data-sound-polish-accept>
          {k.accept}
        </button>
      </div>
    </div>
  );
}
