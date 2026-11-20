'use client';
/**
 * One sound in the list (docs/BRAND-SOUND-STUDIO.md §4.2): play, name, a small waveform, length, like, and a
 * chevron; pressing the name opens it in place (large waveform that seeks, time, actions). A made version also
 * gets a quiet "⋯" menu: save to assets, create similar, copy the description. Run rows (in progress, or
 * failed with nothing taken) sit above the versions.
 */
import { useEffect, useRef, useState } from 'react';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { formatTrackLength, type SoundTrackView } from '@/lib/brand-studio/sound/library';
import { peaksFromChannels } from '@/lib/brand-studio/sound/waveform';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import { Waveform } from './waveform';
import s from './sound.module.css';

export interface RowActions {
  toggle(track: SoundTrackView): void;
  seek(track: SoundTrackView, ratio: number): void;
  like(track: SoundTrackView): void;
  sendCompose(track: SoundTrackView): void;
  addVideo(track: SoundTrackView): void;
  /** Saves a made version to the assets; true when it is there. */
  save(track: SoundTrackView): Promise<boolean>;
  similar(track: SoundTrackView): void;
  /** A made version decoded for the first time: keep its peaks on the server. */
  saveWaveform(track: SoundTrackView, peaks: number[]): void;
}

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="bs-icon" data-filled={filled ? '' : undefined}>
      <path d={d} />
    </svg>
  );
}

const PLAY = 'M7 4.8v10.4l8.4-5.2z';
const PAUSE = 'M6.5 4.5h2.4v11H6.5z M11.1 4.5h2.4v11h-2.4z';
const HEART = 'M10 16.2s-5.8-3.4-5.8-7.6A3.2 3.2 0 0 1 10 6.6a3.2 3.2 0 0 1 5.8 2c0 4.2-5.8 7.6-5.8 7.6z';
const CHEVRON = 'M6 8l4 4 4-4';
const DOWNLOAD = 'M10 4.5v9 M6.5 10 10 13.5 13.5 10 M4.5 15.5h11';
const MORE = 'M4.5 10h.1M10 10h.1M15.5 10h.1';

/** One decoded file at a time is plenty; a long list fills in as it scrolls. */
const peakCache = new Map<string, number[] | 'failed'>();
let decoding: Promise<unknown> = Promise.resolve();

function decodePeaks(url: string): Promise<number[] | 'failed'> {
  const cached = peakCache.get(url);
  if (cached) return Promise.resolve(cached);
  const run = decoding.then(async () => {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('fetch');
      const bytes = await response.arrayBuffer();
      const Ctx: typeof AudioContext | undefined =
        typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
      if (!Ctx) throw new Error('no audio');
      const context = new Ctx();
      try {
        const buffer = await context.decodeAudioData(bytes);
        const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
        const peaks = peaksFromChannels(channels);
        peakCache.set(url, peaks);
        return peaks;
      } finally {
        void context.close().catch(() => undefined);
      }
    } catch {
      peakCache.set(url, 'failed');
      return 'failed' as const;
    }
  });
  decoding = run.catch(() => undefined);
  return run;
}

export function TrackRow(props: {
  track: SoundTrackView;
  name: string;
  copy: StudioSoundCopy;
  open: boolean;
  playing: boolean;
  position: number;
  canCreate: boolean;
  /** The composer holds the screen's accent button: the row's main action is ink-filled instead. */
  primaryInk: boolean;
  onToggleOpen: () => void;
  actions: RowActions;
}) {
  const { track, name, copy, open, playing, actions } = props;
  const row = useRef<HTMLLIElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | 'failed' | null>(() => track.waveform ?? peakCache.get(track.streamUrl) ?? null);

  // Stored peaks draw at once; otherwise decode the file when the row comes into view (and keep the peaks).
  useEffect(() => {
    if (peaks) return;
    const element = row.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void decodePeaks(track.streamUrl).then((value) => {
        if (!alive) return;
        setPeaks(value);
        if (Array.isArray(value)) actions.saveWaveform(track, value);
      });
    });
    observer.observe(element);
    return () => {
      alive = false;
      observer.disconnect();
    };
    // `actions` changes every render; the decode runs once per row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks, track.streamUrl]);

  const progress = track.seconds ? Math.min(1, props.position / track.seconds) : 0;
  const values = Array.isArray(peaks) ? peaks : null;
  const panelId = `sound-row-${track.key.replace(':', '-')}`;
  const download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'audio'}`;

  return (
    <li ref={row} className={s.row} data-sound-row={track.assetId ?? track.outputId} data-sound-key={track.key} data-open={open ? '' : undefined} data-playing={playing ? '' : undefined} data-sound-made={track.outputId ? '' : undefined}>
      <div className={s.line}>
        <button
          type="button"
          className={s.play}
          aria-label={interpolate(playing ? copy.row.pause : copy.row.play, { name })}
          aria-pressed={playing}
          onClick={() => actions.toggle(track)}
          data-sound-play
        >
          <Icon d={playing ? PAUSE : PLAY} filled />
        </button>
        <button
          type="button"
          className={s.name}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={interpolate(open ? copy.row.collapse : copy.row.expand, { name })}
          onClick={props.onToggleOpen}
          data-sound-open
        >
          <span className={s.nameText}>{name}</span>
        </button>
        <div className={s.mini} aria-hidden="true">
          <Waveform peaks={values} progress={progress} compact />
        </div>
        <span className={s.length} data-sound-length>
          {formatTrackLength(track.seconds)}
        </span>
        <button
          type="button"
          className={s.iconBtn}
          aria-label={interpolate(track.liked ? copy.row.unlike : copy.row.like, { name })}
          aria-pressed={track.liked}
          onClick={() => actions.like(track)}
          data-sound-like
        >
          <Icon d={HEART} filled={track.liked} />
        </button>
        <button type="button" className={s.iconBtn} aria-hidden="true" tabIndex={-1} onClick={props.onToggleOpen} data-chevron>
          <Icon d={CHEVRON} />
        </button>
      </div>
      {open ? (
        <div id={panelId} className={s.panel} data-sound-panel>
          <div className={s.big}>
            <Waveform peaks={values} progress={progress} onSeek={track.seconds ? (ratio) => actions.seek(track, ratio) : undefined} label={name} />
            <span className={s.time} data-sound-time>
              {formatTrackLength(props.position)} / {formatTrackLength(track.seconds)}
            </span>
          </div>
          <div className={s.actions}>
            {props.canCreate ? (
              <button
                type="button"
                className={props.primaryInk ? `bs-btn ${s.inkBtn}` : 'bs-btn'}
                data-variant={props.primaryInk ? undefined : 'solid'}
                data-size="sm"
                onClick={() => actions.sendCompose(track)}
                data-sound-send-compose
              >
                {copy.actions.sendCompose}
              </button>
            ) : null}
            {props.canCreate ? (
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => actions.addVideo(track)} data-sound-add-video>
                {copy.actions.addVideo}
              </button>
            ) : null}
            <a className={`bs-btn ${s.pushRight}`} data-variant="ghost" data-size="sm" href={track.streamUrl} download={download} data-sound-download>
              <Icon d={DOWNLOAD} />
              {copy.actions.download}
            </a>
            {track.outputId && props.canCreate ? <RowMenu track={track} name={name} copy={copy} actions={actions} /> : null}
          </div>
          {track.lyrics ? (
            <div className={s.sung} data-sound-sung>
              <span className={s.lyricsLabel}>{copy.composer.lyrics}</span>
              <p className={s.sungText}>{track.lyrics}</p>
            </div>
          ) : null}
          {track.outputId ? <TermsLine copy={copy} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function RowMenu(props: { track: SoundTrackView; name: string; copy: StudioSoundCopy; actions: RowActions }) {
  const { track, copy, actions } = props;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ saved?: boolean; copied?: boolean }>({});
  const box = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const saved = Boolean(track.assetId) || state.saved;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div
      ref={box}
      className={s.menuBox}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={s.iconBtn}
        aria-label={interpolate(copy.row.more, { name: props.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-sound-more
      >
        <Icon d={MORE} />
      </button>
      {open ? (
        <div className={s.menu} role="menu" data-sound-menu>
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            disabled={saved}
            onClick={async () => {
              if (await actions.save(track)) setState((v) => ({ ...v, saved: true }));
            }}
            data-sound-save
          >
            {saved ? copy.more.saved : copy.more.save}
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={() => {
              setOpen(false);
              actions.similar(track);
            }}
            data-sound-similar
          >
            {copy.more.similar}
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(track.prompt ?? '');
                setState((v) => ({ ...v, copied: true }));
              } catch {
                // Clipboard blocked: nothing to say; the description is still in the row's run.
              }
            }}
            data-sound-copy
          >
            {state.copied ? copy.more.copied : copy.more.copy}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The terms line under a made version, and its small panel (docs/BRAND-SOUND-STUDIO.md §4.6). The wording is the
 * §4.7 draft that waits for the founder's final text and the terms clauses (§8-3). Only on music made here: an
 * uploaded file is the brand's own.
 */
function TermsLine({ copy }: { copy: StudioSoundCopy }) {
  const [open, setOpen] = useState(false);
  const panelId = useRef(`sound-terms-${Math.random().toString(36).slice(2, 8)}`);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    // The page's floating dock may cover the panel: measure it, then bring the panel above it.
    const dock = document.querySelector<HTMLElement>('[data-sound-composer]');
    if (dock) document.documentElement.style.setProperty('--sound-dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
    const panel = document.getElementById(panelId.current);
    panel?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    closeButton.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div className={s.terms} data-sound-terms>
      <p className={s.termsLine}>
        {copy.terms.line}
        <button type="button" className={s.textBtn} aria-expanded={open} aria-controls={panelId.current} onClick={() => setOpen((v) => !v)} data-sound-terms-link>
          {copy.terms.link}
        </button>
      </p>
      {open ? (
        <div
          id={panelId.current}
          className={s.termsPanel}
          role="dialog"
          aria-label={copy.terms.title}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          data-sound-terms-panel
        >
          <p className={s.termsTitle}>{copy.terms.title}</p>
          <ul className={s.termsList}>
            {copy.terms.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <button ref={closeButton} type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => setOpen(false)}>
            {copy.terms.close}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A run still being made, or one that failed and took nothing. */
export function PendingRow(props: { job: StudioJobView; copy: StudioSoundCopy; state: 'making' | 'failed'; line?: string }) {
  const { job, copy } = props;
  const title = job.music?.title ?? job.prompt;
  return (
    <li className={s.row} data-sound-run={props.state} data-sound-job={job.id}>
      <div className={s.runLine}>
        <span className={s.runMark} data-state={props.state} aria-hidden="true" />
        <span className={s.nameText}>{title}</span>
        <span className={s.runText} role={props.state === 'failed' ? 'note' : undefined}>
          {props.state === 'making' ? copy.composer.making : props.line}
        </span>
        {props.state === 'making' ? <span className={s.progress} aria-hidden="true" /> : null}
      </div>
    </li>
  );
}
