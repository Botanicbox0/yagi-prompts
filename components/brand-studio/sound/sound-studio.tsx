'use client';
/**
 * The sound studio screen (docs/BRAND-SOUND-STUDIO.md §4.2, §7.3, §7.4).
 *  SS1: the two tabs, the brand's audio as hairline rows, one shared player, a waveform per visible row,
 *       upload, likes, and sending a sound to the editing studio or a saved video studio project.
 *  SS2: the music composer (description + vocals), runs in progress, the versions each request returned
 *       (A, B…), failures that took nothing, save to assets, "비슷하게 만들기", copy the description.
 *  SS3: lyrics (by hand or a free draft), "더 고르게 만들기", lyrics and the terms line on a made version.
 *  SA1: the music Prompt Architect in the dock, and "보낸 문장 보기" on a made version.
 *
 * Techniques (docs/design/TOOLBOX.md §1-3), four: hairline rows instead of cards (TASTE 16), recessed wells for
 * the search field and the description, tabular numerals for every length, time and credit, frosted glass on
 * the floating dock and the one overlay. One accent-filled button on the screen: 만들기 when the composer is
 * there, else the open row's main action (TASTE 19); with the composer, the row's main action is ink-filled.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createStudioApi, isFailure, measureInBrowser } from '@/components/brand-studio/api';
import { newRequestId } from '@/components/brand-studio/copy';
import { STUDIO_JOB_SETTLED, STUDIO_JOB_STARTED, announce } from '@/components/brand-studio/seams';
import { settledJobs } from '@/components/brand-studio/use-studio';
import { windowText, type AllowanceWindowView } from '@/lib/brand-studio/allowance-window';
import { composeStorageKey } from '@/lib/brand-studio/compose/timeline';
import type { StudioAllowanceView, StudioErrorCode, StudioJobView } from '@/lib/brand-studio/contracts';
import { creditsLeft, formatCredits } from '@/lib/brand-studio/credits';
import { filterTracks, mergeTracks, musicTracks, soundTracks, type SoundTab, type SoundTrackView } from '@/lib/brand-studio/sound/library';
import { composeBgmHandoff, composeSfxHandoff, type SoundSendTrack } from '@/lib/brand-studio/sound/send';
import type { BillingPlanCatalogueItem } from '@/lib/brands/billing-ui';
import type { BrandBillingCopy } from '@/messages/brand-billing';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import { StudioAllowanceNotice } from '../studio-allowance-notice';
import { MusicComposer, type ComposerHandle, type ComposerInput } from './composer';
import { SendToVideoDialog, type SendTarget } from './send-dialog';
import { PendingRow, TrackRow, type RowActions } from './track-row';
import s from './sound.module.css';

export interface SoundStudioProps {
  organizationId: string;
  organizationName?: string | null;
  locale: 'ko' | 'en';
  copy: StudioSoundCopy;
  billingCopy?: BrandBillingCopy['customer'];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  /** `brandStudio.credits`: `{n} 크레딧`, `남은 크레딧 {n}`. */
  creditsCopy: { amount: string; left: string };
  initialTab: SoundTab;
  /** The brand's audio files (uploads, older generated sound). */
  initialTracks: SoundTrackView[];
  /** Music runs: open, finished, and failed in the last day. */
  initialJobs: StudioJobView[];
  /** SA4: library videos "영상 길이" can fit music to (ready, with a length). */
  initialVideos?: Array<{ assetId: string; name: string; seconds: number }>;
  initialAllowance: StudioAllowanceView;
  /** "더 고르게 만들기" is offered (server setting `BRAND_SOUND_MAX_MODE=on`; hidden by default). */
  maxMode: boolean;
  /** Owners and editors: create, upload and send. Viewers and the TWINGS team view listen and download. */
  canCreate: boolean;
  audioMaxMb: number;
  hrefs: { page: string; compose: string; video: string };
}

type Notice = { text: string; href?: string } | null;

const OPEN = new Set(['held', 'queued', 'running', 'finishing']);
const POLL_MS = 3000;

function dateLabel(iso: string, locale: 'ko' | 'en'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric' }).format(date);
}

/** The sound studio's sentence for a refusal. `window` (R1): a billing cycle drops "this month" from the credit line. */
export function soundErrorLine(copy: StudioSoundCopy, code: StudioErrorCode | 'artist', window?: Pick<AllowanceWindowView, 'kind'> | null): string {
  switch (code) {
    case 'artist':
      return copy.errors.artist;
    case 'allowance_exhausted':
      return windowText(window, copy.errors.allowance, copy.errors.allowanceCycle);
    case 'allowance_closed':
    case 'feature_unavailable':
    case 'not_found':
      return copy.errors.closed;
    case 'too_many_running':
      return copy.errors.busy;
    case 'provider_rejected':
      return copy.errors.blocked;
    default:
      return copy.errors.generic;
  }
}

export function SoundStudio(props: SoundStudioProps) {
  const { copy, organizationId, locale, canCreate } = props;
  const api = useMemo(() => createStudioApi({ organizationId }), [organizationId]);
  const [tab, setTab] = useState<SoundTab>(props.initialTab);
  const [files, setFiles] = useState<SoundTrackView[]>(props.initialTracks.filter((t) => !t.outputId));
  const [jobs, setJobs] = useState<StudioJobView[]>(props.initialJobs);
  // A run this screen watched has settled: the rail refreshes its credits and shows a toast elsewhere (as the
  // image board does). Real-screen check 2026-11-21: the rail kept the old figure until a reload.
  const seenJobs = useRef<Map<string, StudioJobView['status']> | null>(null);
  useEffect(() => {
    for (const event of settledJobs(seenJobs.current, jobs)) announce(STUDIO_JOB_SETTLED, event);
    seenJobs.current = new Map(jobs.map((job) => [job.id, job.status]));
  }, [jobs]);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [allowance, setAllowance] = useState<StudioAllowanceView>(props.initialAllowance);
  const [query, setQuery] = useState('');
  const [likedOnly, setLikedOnly] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [allowanceErrorCode, setAllowanceErrorCode] = useState<'allowance_closed' | 'allowance_exhausted' | null>(null);
  const [lastNeededCredits, setLastNeededCredits] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [replace, setReplace] = useState<{ track: SoundTrackView; current: string } | null>(null);
  const [videoTarget, setVideoTarget] = useState<SendTarget | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const composer = useRef<ComposerHandle | null>(null);
  const draftRequest = useRef<string | null>(null);

  /* ------------------------------------------------------------------ rows */
  const initialMadeLikes = useMemo(
    () => Object.fromEntries(props.initialTracks.filter((t) => t.outputId).map((t) => [t.key, t.liked])),
    [props.initialTracks],
  );
  const tracks = useMemo(() => {
    const made = musicTracks(organizationId, jobs, []).map((t) => ({
      ...t,
      liked: likes[t.key] ?? initialMadeLikes[t.key] ?? false,
      assetId: saved[t.key] ?? t.assetId,
    }));
    const own = files.map((t) => ({ ...t, liked: likes[t.key] ?? t.liked }));
    return mergeTracks(made, own);
  }, [files, jobs, likes, saved, initialMadeLikes, organizationId]);
  const shown = useMemo(() => filterTracks(tracks, tab, { query, likedOnly }), [tracks, tab, query, likedOnly]);
  const tabCount = useMemo(() => tracks.filter((t) => t.tab === tab).length, [tracks, tab]);
  const openJobs = useMemo(() => jobs.filter((j) => OPEN.has(j.status)), [jobs]);
  const failedJobs = useMemo(() => jobs.filter((j) => j.status === 'failed' || j.status === 'canceled'), [jobs]);
  const searching = query.trim() !== '' || likedOnly;

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

  /* ------------------------------------------------------------------ runs */
  // Open runs are polled; the poll also moves them forward on the server (the studio's own engine).
  const openIds = openJobs.map((j) => j.id).join(',');
  useEffect(() => {
    if (!openIds) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      const answer = await api.poll(openIds.split(','));
      if (!alive || isFailure(answer)) return;
      setAllowance(answer.allowance);
      setJobs((all) => {
        const next = all.map((job) => answer.jobs.find((j) => j.id === job.id) ?? job);
        for (const job of answer.jobs) {
          const before = all.find((j) => j.id === job.id);
          if (before && OPEN.has(before.status) && job.status === 'succeeded') {
            setNotice({ text: interpolate(copy.composer.versions, { count: job.outputs.length }) });
          }
        }
        return next;
      });
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [api, openIds, copy.composer.versions]);

  const create = async (input: ComposerInput) => {
    setCreating(true);
    setComposerError(null);
    setAllowanceErrorCode(null);
    setLastNeededCredits(typeof input.quotedCredits === 'number' ? input.quotedCredits : null);
    // One id per draft: a retried press (double click, a dropped answer) is the same request on the server.
    draftRequest.current ??= newRequestId();
    let answer: unknown;
    try {
      const response = await fetch('/api/brand-studio', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'job.create',
          input: {
            kind: 'music',
            organizationId,
            requestId: draftRequest.current,
            prompt: input.prompt,
            vocal: input.vocal,
            language: locale,
            ...(input.vocal && input.lyrics ? { lyrics: input.lyrics, structure: input.structure, targetSeconds: input.targetSeconds, ...(input.lyricsBy ? { lyricsBy: input.lyricsBy } : {}), ...(input.videoAssetId ? { videoAssetId: input.videoAssetId } : {}) } : {}),
            ...(input.careful ? { careful: true } : {}),
            ...(input.vocal && !input.lyrics && input.words ? { words: input.words } : {}),
            ...(input.vocal && input.lyrics && input.bpm ? { bpm: input.bpm } : {}),
            architect: input.architect,
            ...(input.designed ? { designed: input.designed } : {}),
          },
        }),
      });
      answer = await response.json();
    } catch {
      answer = null;
    }
    setCreating(false);
    const result = answer as { ok?: boolean; job?: StudioJobView; code?: StudioErrorCode; blocked?: 'name' | 'lyrics' | 'paused' } | null;
    if (result?.ok && result.job) {
      draftRequest.current = null;
      setJobs((all) => [result.job!, ...all.filter((j) => j.id !== result.job!.id)]);
      // The rail reads the credits and the running count again (as the reverse panel tells it), and this screen's
      // own figure reads the reservation at once instead of on the next poll: both show the same number.
      announce(STUDIO_JOB_STARTED, { jobId: result.job.id });
      void api.poll([result.job.id]).then((polled) => {
        if (!isFailure(polled)) setAllowance(polled.allowance);
      });
      chooseTab('music');
      return true;
    }
    if (result?.blocked === 'name') setComposerError(soundErrorLine(copy, 'artist'));
    else if (result?.blocked === 'lyrics') setComposerError(copy.composer.lyricsBlocked);
    else if (result?.blocked === 'paused') setComposerError(copy.errors.paused);
    else if (result?.code === 'allowance_closed' || result?.code === 'allowance_exhausted') {
      setAllowanceErrorCode(result.code);
    } else setComposerError(soundErrorLine(copy, result?.code ?? 'failed', allowance.window));
    // A refused request reserved nothing: the next press is a new one.
    if (result?.code) draftRequest.current = null;
    return false;
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
      element.dataset.key = track.key;
      element.src = track.streamUrl;
    }
    element.currentTime = Math.max(0, Math.min(track.seconds, ratio * track.seconds));
    setPosition(element.currentTime);
  };

  /* ------------------------------------------------------------------ likes */
  const like = async (track: SoundTrackView) => {
    const liked = !track.liked;
    setLikes((all) => ({ ...all, [track.key]: liked }));
    const ref = track.outputId ? { outputId: track.outputId } : { assetId: track.assetId };
    try {
      const response = await fetch('/api/brand-studio/library', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'like.toggle', input: { organizationId, ref, liked } }),
      });
      if (!response.ok) throw new Error('like');
    } catch {
      setLikes((all) => ({ ...all, [track.key]: !liked }));
    }
  };

  /* ------------------------------------------------------------------ upload */
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length === 0) return;
    setUploading(true);
    setNotice(null);
    let failed = false;
    for (const file of picked) {
      const result = await api.upload(file, { measure: measureInBrowser });
      if (isFailure(result) || result.asset.kind !== 'audio') {
        failed = true;
        continue;
      }
      const [row] = soundTracks(organizationId, [result.asset], []);
      if (row) setFiles((all) => [row, ...all.filter((t) => t.key !== row.key)]);
    }
    setUploading(false);
    if (failed) setNotice({ text: copy.upload.failed });
    else chooseTab('music');
  };

  /* ------------------------------------------------------------------ save and send */
  /** A made version is saved to the assets first (named as the row), so it can be sent and found again. */
  const ensureAsset = async (track: SoundTrackView): Promise<string | null> => {
    if (track.assetId) return track.assetId;
    if (!track.outputId) return null;
    const result = await api.call('asset.from_output', { organizationId, outputId: track.outputId, name: nameOf(track).slice(0, 120) });
    if (isFailure(result)) return null;
    setSaved((all) => ({ ...all, [track.key]: result.asset.id }));
    return result.asset.id;
  };

  const sendTrack = (track: SoundTrackView, assetId: string): SoundSendTrack => ({
    assetId,
    label: nameOf(track),
    seconds: track.seconds,
    srcUrl: `/api/brand-studio/compose?${new URLSearchParams({ organizationId, source: 'asset', id: assetId }).toString()}`,
  });

  const sendToCompose = async (track: SoundTrackView, replaceExisting: boolean) => {
    const assetId = await ensureAsset(track);
    if (!assetId) {
      setNotice({ text: copy.send.failed });
      return;
    }
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(composeStorageKey(organizationId));
    } catch {
      raw = null;
    }
    if (track.tab === 'sfx') {
      const placed = composeSfxHandoff(raw, sendTrack(track, assetId), `sfx_${newRequestId().slice(-12)}`);
      if (placed.status === 'full') {
        setNotice({ text: copy.send.sfxFull });
        return;
      }
      return writeAndOpen(placed.stored);
    }
    const placed = composeBgmHandoff(raw, sendTrack(track, assetId), replaceExisting);
    if (placed.status === 'replace_needed') {
      setReplace({ track: { ...track, assetId }, current: placed.currentLabel });
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

  const addToVideo = async (track: SoundTrackView) => {
    const assetId = await ensureAsset(track);
    if (!assetId) {
      setNotice({ text: copy.send.failed });
      return;
    }
    setVideoTarget({ track: sendTrack(track, assetId), kind: track.tab === 'sfx' ? 'sfx' : 'bgm' });
  };

  const actions: RowActions = {
    toggle,
    seek,
    like: (track) => void like(track),
    sendCompose: (track) => void sendToCompose(track, false),
    addVideo: (track) => void addToVideo(track),
    save: async (track) => Boolean(await ensureAsset(track)),
    similar: (track) => {
      composer.current?.fill({ prompt: track.prompt ?? '', vocal: track.vocal ?? false, lyrics: track.lyrics, careful: track.careful });
    },
    saveWaveform: (track, peaks) => {
      if (!track.outputId || track.waveform) return;
      void api.call('output.waveform', { organizationId, outputId: track.outputId, peaks });
    },
  };

  const left = creditsLeft(allowance.capKrw, allowance.usedKrw);
  const soundClosed = canCreate && (allowance.capKrw <= 0 || allowanceErrorCode === 'allowance_closed');
  const soundExhausted = canCreate && !soundClosed && (left <= 0 || allowanceErrorCode === 'allowance_exhausted');
  const showComposer = canCreate && tab === 'music';

  // The dock's height, for the rows' scroll margin (an opened row comes into view above it).
  useEffect(() => {
    const page = pageRef.current;
    const dock = page?.querySelector<HTMLElement>('[data-sound-composer]');
    if (!page || !dock || typeof ResizeObserver === 'undefined') return;
    const measure = () => page.style.setProperty('--sound-dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [showComposer]);

  return (
    <div ref={pageRef} className={`bs-page ${s.page}`} data-brand-studio-v2 data-studio-sound data-sound-tab-current={tab} data-sound-composer-open={showComposer ? '' : undefined}>
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
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search.placeholder} data-sound-search />
          </label>
          <button type="button" className={s.pill} aria-pressed={likedOnly} onClick={() => setLikedOnly((v) => !v)} data-sound-liked-only>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="bs-icon" data-filled={likedOnly ? '' : undefined}>
              <path d="M10 16.2s-5.8-3.4-5.8-7.6A3.2 3.2 0 0 1 10 6.6a3.2 3.2 0 0 1 5.8 2c0 4.2-5.8 7.6-5.8 7.6z" />
            </svg>
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
                <svg viewBox="0 0 20 20" aria-hidden="true" className="bs-icon">
                  <path d="M10 13.5V4.5 M6.5 8 10 4.5 13.5 8 M4.5 15.5h11" />
                </svg>
                {uploading ? copy.upload.uploading : copy.upload.button}
              </button>
              <input ref={fileInput} type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" multiple hidden onChange={onFiles} />
            </>
          ) : null}
          <span className={s.credits} data-sound-credits>
            {interpolate(props.creditsCopy.left, { n: formatCredits(left, locale) })}
          </span>
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
        {tab === 'music' && !searching && (openJobs.length > 0 || failedJobs.length > 0) ? (
          <ul className={s.rows} data-sound-runs>
            {openJobs.map((job) => (
              <PendingRow key={job.id} job={job} copy={copy} state="making" />
            ))}
            {failedJobs.map((job) => (
              <PendingRow
                key={job.id}
                job={job}
                copy={copy}
                state="failed"
                line={job.errorCode === 'provider_rejected' ? copy.errors.blocked : copy.errors.failed}
                {...(job.errorCode === 'provider_rejected'
                  ? {
                      onRedesign: () =>
                        composer.current?.redesign({ prompt: job.prompt ?? '', vocal: job.music?.vocal ?? false, lyrics: job.music?.lyrics ?? null, careful: job.music?.careful ?? false }),
                    }
                  : {})}
              />
            ))}
          </ul>
        ) : null}
        {shown.length === 0 ? (
          tab === 'music' && !searching && openJobs.length + failedJobs.length > 0 ? null : (
            <p className={s.empty} data-sound-empty>
              {tabCount === 0 ? copy.empty[tab] : copy.noMatch}
            </p>
          )
        ) : (
          <ul className={s.rows} data-sound-tracks>
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
                primaryInk={showComposer}
                onToggleOpen={() => setOpenKey((key) => (key === track.key ? null : track.key))}
                actions={actions}
              />
            ))}
          </ul>
        )}
      </section>

      {soundClosed ? (
        <StudioAllowanceNotice
          kind="closed"
          organizationId={organizationId}
          organizationName={props.organizationName}
          locale={locale}
          billingCopy={props.billingCopy}
          planCatalogue={props.planCatalogue}
          surface="studio_sound"
          solidCta
        />
      ) : null}

      {soundExhausted ? (
        <StudioAllowanceNotice
          kind="exhausted"
          organizationId={organizationId}
          organizationName={props.organizationName}
          locale={locale}
          billingCopy={props.billingCopy}
          planCatalogue={props.planCatalogue}
          neededCredits={lastNeededCredits}
          remainingCredits={left}
          resetsAt={allowance.resetsAt}
          allowanceWindow={allowance.window}
          surface="studio_sound"
          solidCta={false}
        />
      ) : null}

      {showComposer ? (
        <MusicComposer
          ref={composer}
          copy={copy}
          locale={locale}
          amountTemplate={props.creditsCopy.amount}
          busy={creating}
          showExamples={!tracks.some((t) => t.outputId) && openJobs.length === 0}
          error={composerError}
          onCreate={(input) => void create(input)}
          onClearError={() => setComposerError(null)}
          maxMode={props.maxMode}
          videos={props.initialVideos ?? []}
          onDesign={async (request) => {
            const answer = await api.call('music.design', {
              organizationId,
              structure: request.structure,
              ...(request.avoid ? { avoid: true } : {}),
              ...(request.videoAssetId ? { videoAssetId: request.videoAssetId } : {}),
              prompt: request.prompt,
              vocal: request.vocal,
              language: locale,
              ...(request.vocal && request.lyrics ? { lyrics: request.lyrics } : {}),
              ...(request.vocal && !request.lyrics && request.words ? { words: request.words } : {}),
              ...(request.vocal && request.lyrics
                ? { targetSeconds: request.targetSeconds, ...(request.bpm ? { bpm: request.bpm } : {}), ...(request.lyricsBy ? { lyricsBy: request.lyricsBy } : {}) }
                : {}),
              ...(request.careful ? { careful: true } : {}),
            });
            if (!isFailure(answer)) return { design: answer.design };
            if (answer.code === 'allowance_closed' || answer.code === 'allowance_exhausted') {
              setAllowanceErrorCode(answer.code);
              setLastNeededCredits(null);
              return { allowanceCode: answer.code };
            }
            const blocked = (answer as { blocked?: string }).blocked;
            if (blocked === 'name') return { error: copy.errors.artist };
            if (blocked === 'lyrics') return { error: copy.composer.lyricsBlocked };
            return { error: answer.code === 'too_many_running' ? copy.errors.busy : copy.architect.failed };
          }}
          onDraft={async (request) => {
            const answer = await api.call('lyrics.draft', { organizationId, ...request });
            if (!isFailure(answer)) return { lyrics: answer.lyrics, model: answer.model, bpm: answer.bpm };
            if (answer.code === 'allowance_closed' || answer.code === 'allowance_exhausted') {
              setAllowanceErrorCode(answer.code);
              setLastNeededCredits(null);
              return { allowanceCode: answer.code };
            }
            if ((answer as { blocked?: string }).blocked === 'name') return { error: request.flow === 'polish' ? copy.composer.lyricsBlocked : copy.errors.artist };
            if (answer.code === 'too_many_running') return { error: copy.composer.draftBusy };
            return { error: request.flow === 'polish' ? copy.lyricsKit.polishFailed : copy.composer.draftFailed };
          }}
        />
      ) : null}

      {replace ? (
        <ConfirmReplace
          copy={copy}
          current={replace.current}
          onCancel={() => setReplace(null)}
          onReplace={() => {
            const track = replace.track;
            setReplace(null);
            void sendToCompose(track, true);
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
