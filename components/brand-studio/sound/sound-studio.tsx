'use client';
/**
 * The sound studio screen (docs/BRAND-SOUND-STUDIO.md §4.2, §7.3). Slice SS1: the two tabs, the list of the
 * brand's audio as hairline rows, one shared player, a waveform per visible row, upload, likes, and sending
 * a sound to the editing studio or a saved video studio project. Nothing here spends credits.
 *
 * Techniques (docs/design/TOOLBOX.md §1-3), four: hairline rows instead of cards (TASTE 16), a recessed well
 * for the search field, tabular numerals for every length and time, frosted glass only on the one overlay
 * (the project picker). One filled button on the screen: the open row's main action.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createStudioApi, isFailure, measureInBrowser } from '@/components/brand-studio/api';
import { newRequestId } from '@/components/brand-studio/copy';
import { composeStorageKey } from '@/lib/brand-studio/compose/timeline';
import {
  filterTracks,
  formatTrackLength,
  soundTracks,
  type SoundTab,
  type SoundTrackView,
} from '@/lib/brand-studio/sound/library';
import { composeBgmHandoff, composeSfxHandoff, type SoundSendTrack } from '@/lib/brand-studio/sound/send';
import { peaksFromChannels } from '@/lib/brand-studio/sound/waveform';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import { SendToVideoDialog, type SendTarget } from './send-dialog';
import { Waveform } from './waveform';
import s from './sound.module.css';

export interface SoundStudioProps {
  organizationId: string;
  locale: 'ko' | 'en';
  copy: StudioSoundCopy;
  initialTab: SoundTab;
  initialTracks: SoundTrackView[];
  /** Owners and editors: upload and send. Viewers and the TWINGS team view listen and download. */
  canCreate: boolean;
  audioMaxMb: number;
  hrefs: { page: string; compose: string; video: string };
}

type Notice = { text: string; href?: string } | null;

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
const UPLOAD = 'M10 13.5V4.5 M6.5 8 10 4.5 13.5 8 M4.5 15.5h11';
const DOWNLOAD = 'M10 4.5v9 M6.5 10 10 13.5 13.5 10 M4.5 15.5h11';

/** One decoded waveform at a time is plenty; a long list fills in as it scrolls. */
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

function dateLabel(iso: string, locale: 'ko' | 'en'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric' }).format(date);
}

export function SoundStudio(props: SoundStudioProps) {
  const { copy, organizationId, locale, canCreate } = props;
  const api = useMemo(() => createStudioApi({ organizationId }), [organizationId]);
  const [tab, setTab] = useState<SoundTab>(props.initialTab);
  const [tracks, setTracks] = useState<SoundTrackView[]>(props.initialTracks);
  const [query, setQuery] = useState('');
  const [likedOnly, setLikedOnly] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [replace, setReplace] = useState<{ track: SoundTrackView; current: string } | null>(null);
  const [videoTarget, setVideoTarget] = useState<SendTarget | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const shown = useMemo(() => filterTracks(tracks, tab, { query, likedOnly }), [tracks, tab, query, likedOnly]);
  const tabCount = useMemo(() => tracks.filter((t) => t.tab === tab).length, [tracks, tab]);

  const nameOf = useCallback(
    (track: SoundTrackView) =>
      track.displayName ??
      interpolate(track.source === 'upload' ? copy.row.untitledUpload : copy.row.untitledMade, { date: dateLabel(track.createdAt, locale) }),
    [copy.row.untitledMade, copy.row.untitledUpload, locale],
  );

  // The tab lives in the address so a reload, a link or the back button opens the same one.
  const chooseTab = (next: SoundTab) => {
    setTab(next);
    setOpenKey(null);
    try {
      const url = new URL(window.location.href);
      if (next === 'music') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // The tab still changes on screen.
    }
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: SoundTab = tab === 'music' ? 'sfx' : 'music';
    chooseTab(next);
    (event.currentTarget.querySelector(`[data-sound-tab="${next}"]`) as HTMLButtonElement | null)?.focus();
  };

  /* ------------------------------------------------------------------ player */
  useEffect(() => {
    const element = new Audio();
    element.preload = 'none';
    audio.current = element;
    const tick = () => setPosition(element.currentTime || 0);
    const ended = () => {
      setPlayingKey(null);
      setPosition(0);
    };
    const played = () => setPlayingKey(element.dataset.key ?? null);
    const paused = () => setPlayingKey(null);
    element.addEventListener('timeupdate', tick);
    element.addEventListener('ended', ended);
    element.addEventListener('play', played);
    element.addEventListener('pause', paused);
    return () => {
      element.pause();
      element.removeEventListener('timeupdate', tick);
      element.removeEventListener('ended', ended);
      element.removeEventListener('play', played);
      element.removeEventListener('pause', paused);
      audio.current = null;
    };
  }, []);

  const toggle = (track: SoundTrackView) => {
    const element = audio.current;
    if (!element) return;
    if (playingKey === track.key) {
      element.pause();
      return;
    }
    if (element.dataset.key !== track.key) {
      element.pause();
      element.dataset.key = track.key;
      element.src = track.streamUrl;
      setPosition(0);
    }
    void element.play().catch(() => setPlayingKey(null));
  };

  const seek = (track: SoundTrackView, ratio: number) => {
    const element = audio.current;
    if (!element || !track.seconds) return;
    if (element.dataset.key !== track.key) {
      element.src = track.streamUrl;
      element.dataset.key = track.key;
    }
    element.currentTime = Math.max(0, Math.min(track.seconds, ratio * track.seconds));
    setPosition(element.currentTime);
  };

  /* ------------------------------------------------------------------ likes */
  const like = async (track: SoundTrackView) => {
    const liked = !track.liked;
    setTracks((all) => all.map((t) => (t.key === track.key ? { ...t, liked } : t)));
    try {
      const response = await fetch('/api/brand-studio/library', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'like.toggle', input: { organizationId, ref: { assetId: track.assetId }, liked } }),
      });
      if (!response.ok) throw new Error('like');
    } catch {
      setTracks((all) => all.map((t) => (t.key === track.key ? { ...t, liked: !liked } : t)));
    }
  };

  /* ------------------------------------------------------------------ upload */
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setNotice(null);
    let failed = false;
    for (const file of files) {
      const saved = await api.upload(file, { measure: measureInBrowser });
      if (isFailure(saved) || saved.asset.kind !== 'audio') {
        failed = true;
        continue;
      }
      const [row] = soundTracks(organizationId, [saved.asset], []);
      if (row) setTracks((all) => [row, ...all.filter((t) => t.key !== row.key)]);
    }
    setUploading(false);
    if (failed) setNotice({ text: copy.upload.failed });
    else chooseTab('music');
  };

  /* ------------------------------------------------------------------ send */
  const sendTrack = (track: SoundTrackView): SoundSendTrack => ({
    assetId: track.assetId,
    label: nameOf(track),
    seconds: track.seconds,
    srcUrl: track.streamUrl,
  });

  const sendToCompose = (track: SoundTrackView, replaceExisting: boolean) => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(composeStorageKey(organizationId));
    } catch {
      raw = null;
    }
    if (track.tab === 'sfx') {
      const placed = composeSfxHandoff(raw, sendTrack(track), `sfx_${newRequestId().slice(-12)}`);
      if (placed.status === 'full') {
        setNotice({ text: copy.send.sfxFull });
        return;
      }
      return writeAndOpen(placed.stored);
    }
    const placed = composeBgmHandoff(raw, sendTrack(track), replaceExisting);
    if (placed.status === 'replace_needed') {
      setReplace({ track, current: placed.currentLabel });
      return;
    }
    writeAndOpen(placed.stored);
  };

  const writeAndOpen = (stored: string) => {
    try {
      window.localStorage.setItem(composeStorageKey(organizationId), stored);
    } catch {
      setNotice({ text: copy.send.failed });
      return;
    }
    audio.current?.pause();
    setNotice({ text: copy.send.sentCompose });
    window.location.assign(props.hrefs.compose);
  };

  return (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-studio-sound data-sound-tab-current={tab}>
      <header className={s.head}>
        <div className={s.titles}>
          <h1 className="bs-title">{copy.title}</h1>
          <p className={s.lead}>{copy.lead}</p>
        </div>
        <div className={s.tools}>
          <div className={s.tabs} role="tablist" aria-label={copy.tabsLabel} onKeyDown={onTabKey}>
            {(['music', 'sfx'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                className={s.tab}
                aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1}
                data-sound-tab={key}
                onClick={() => chooseTab(key)}
              >
                {copy.tabs[key]}
              </button>
            ))}
          </div>
          <label className={s.search}>
            <span className="bs-sr">{copy.search.label}</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" className={s.searchIcon}>
              <path d="M9 14.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z M13 13l3.5 3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search.placeholder}
              data-sound-search
            />
          </label>
          <button type="button" className={s.pill} aria-pressed={likedOnly} onClick={() => setLikedOnly((v) => !v)} data-sound-liked-only>
            <Icon d={HEART} filled={likedOnly} />
            {copy.likedOnly}
          </button>
          {canCreate ? (
            <>
              <button
                type="button"
                className="bs-btn"
                data-variant="soft"
                data-size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                title={interpolate(copy.upload.hint, { mb: props.audioMaxMb })}
                data-sound-upload
              >
                <Icon d={UPLOAD} />
                {uploading ? copy.upload.uploading : copy.upload.button}
              </button>
              <input ref={fileInput} type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" multiple hidden onChange={onFiles} />
            </>
          ) : null}
        </div>
      </header>

      <p className={s.notice} role="status" aria-live="polite" data-sound-notice>
        {notice ? (
          <>
            {notice.text}
            {notice.href ? (
              <a href={notice.href} className={s.noticeLink}>
                {copy.send.open}
              </a>
            ) : null}
          </>
        ) : null}
      </p>

      {tab === 'sfx' ? <p className={s.use}>{copy.sfxUse}</p> : null}

      <section className={s.list} role="tabpanel" aria-label={copy.tabs[tab]} data-sound-list={tab} data-sound-count={shown.length}>
        {shown.length === 0 ? (
          <p className={s.empty} data-sound-empty>
            {tabCount === 0 ? copy.empty[tab] : copy.noMatch}
          </p>
        ) : (
          <ul className={s.rows}>
            {shown.map((track) => (
              <TrackRow
                key={track.key}
                track={track}
                name={nameOf(track)}
                copy={copy}
                open={openKey === track.key}
                playing={playingKey === track.key}
                position={audio.current?.dataset.key === track.key ? position : 0}
                canCreate={canCreate}
                onToggleOpen={() => setOpenKey((key) => (key === track.key ? null : track.key))}
                onPlay={() => toggle(track)}
                onSeek={(ratio) => seek(track, ratio)}
                onLike={() => void like(track)}
                onSendCompose={() => sendToCompose(track, false)}
                onAddVideo={() => setVideoTarget({ track: sendTrack(track), kind: track.tab === 'sfx' ? 'sfx' : 'bgm' })}
              />
            ))}
          </ul>
        )}
      </section>

      {replace ? (
        <ConfirmReplace
          copy={copy}
          current={replace.current}
          onCancel={() => setReplace(null)}
          onReplace={() => {
            const track = replace.track;
            setReplace(null);
            sendToCompose(track, true);
          }}
        />
      ) : null}

      {videoTarget ? (
        <SendToVideoDialog
          organizationId={organizationId}
          target={videoTarget}
          copy={copy}
          videoHref={props.hrefs.video}
          onClose={() => setVideoTarget(null)}
          onDone={(href) => {
            setVideoTarget(null);
            setNotice({ text: copy.send.sentVideo, href });
          }}
          onNotice={(text) => setNotice({ text })}
        />
      ) : null}
    </div>
  );
}

interface TrackRowProps {
  track: SoundTrackView;
  name: string;
  copy: StudioSoundCopy;
  open: boolean;
  playing: boolean;
  position: number;
  canCreate: boolean;
  onToggleOpen: () => void;
  onPlay: () => void;
  onSeek: (ratio: number) => void;
  onLike: () => void;
  onSendCompose: () => void;
  onAddVideo: () => void;
}

function TrackRow(props: TrackRowProps) {
  const { track, name, copy, open, playing } = props;
  const row = useRef<HTMLLIElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | 'failed' | null>(() => peakCache.get(track.streamUrl) ?? null);

  // Decode only rows that come into view.
  useEffect(() => {
    if (peaks) return;
    const element = row.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void decodePeaks(track.streamUrl).then((value) => {
        if (alive) setPeaks(value);
      });
    });
    observer.observe(element);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [peaks, track.streamUrl]);

  const progress = track.seconds ? Math.min(1, props.position / track.seconds) : 0;
  const values = Array.isArray(peaks) ? peaks : null;
  const panelId = `sound-row-${track.assetId}`;
  const download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'audio'}`;

  return (
    <li ref={row} className={s.row} data-sound-row={track.assetId} data-open={open ? '' : undefined} data-playing={playing ? '' : undefined}>
      <div className={s.line}>
        <button
          type="button"
          className={s.play}
          aria-label={interpolate(playing ? copy.row.pause : copy.row.play, { name })}
          aria-pressed={playing}
          onClick={props.onPlay}
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
          onClick={props.onLike}
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
            <Waveform peaks={values} progress={progress} onSeek={track.seconds ? props.onSeek : undefined} label={name} />
            <span className={s.time} data-sound-time>
              {formatTrackLength(props.position)} / {formatTrackLength(track.seconds)}
            </span>
          </div>
          <Actions>
            {props.canCreate ? (
              <button type="button" className="bs-btn" data-variant="solid" data-size="sm" onClick={props.onSendCompose} data-sound-send-compose>
                {copy.actions.sendCompose}
              </button>
            ) : null}
            {props.canCreate ? (
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={props.onAddVideo} data-sound-add-video>
                {copy.actions.addVideo}
              </button>
            ) : null}
            <a className="bs-btn" data-variant="ghost" data-size="sm" href={track.streamUrl} download={download} data-sound-download>
              <Icon d={DOWNLOAD} />
              {copy.actions.download}
            </a>
          </Actions>
        </div>
      ) : null}
    </li>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className={s.actions}>{children}</div>;
}

function ConfirmReplace(props: { copy: StudioSoundCopy; current: string; onCancel: () => void; onReplace: () => void }) {
  const { copy } = props;
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className={s.scrim} role="presentation" onClick={props.onCancel}>
      <div
        className={s.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-label={interpolate(copy.send.replaceTitle, { current: props.current })}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onCancel();
        }}
        data-sound-replace
      >
        <p className={s.dialogTitle}>{interpolate(copy.send.replaceTitle, { current: props.current })}</p>
        <div className={s.dialogActions}>
          <button ref={first} type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={props.onCancel}>
            {copy.send.cancel}
          </button>
          <button type="button" className="bs-btn" data-variant="solid" data-size="sm" onClick={props.onReplace} data-sound-replace-yes>
            {copy.send.replace}
          </button>
        </div>
      </div>
    </div>
  );
}
