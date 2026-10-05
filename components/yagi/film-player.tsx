'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { playFilm } from '@/lib/yagi/playback';

type Labels = Pick<Dictionary['yagi'], 'play' | 'pause' | 'soundOn' | 'soundOff' | 'viewFilm' | 'closeFilm' | 'filmLoading' | 'filmError' | 'retryFilm'>;

/** Poster first; silent motion only in view. A manual pause persists across scrolling. */
export function FilmPlayer({ src, poster, label, labels, autoplay = false, eager = false }: {
  src: string; poster: string; label: string; labels: Labels; autoplay?: boolean; eager?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const viewer = useRef<HTMLVideoElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const viewerId = useId();
  const startTime = useRef(0);
  const manualPause = useRef(false);
  const visible = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function resumeIfAllowed() {
      if (!video || !autoplay || motion.matches || manualPause.current || !visible.current || document.hidden || document.querySelector('[data-yagi-viewer][open]')) return;
      void playFilm(video, () => setProblem(true));
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = Boolean(entry?.isIntersecting);
      if (!visible.current) video.pause(); else resumeIfAllowed();
    }, { threshold: 0.3 });
    function visibility() { if (document.hidden) video?.pause(); else resumeIfAllowed(); }
    function preference() { if (motion.matches) video?.pause(); else resumeIfAllowed(); }
    observer.observe(video);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', preference);
    return () => { observer.disconnect(); video.pause(); document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', preference); };
  }, [src, autoplay]);

  useEffect(() => {
    const modal = dialog.current;
    const film = viewer.current;
    if (!expanded || !modal || !film) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.querySelectorAll<HTMLVideoElement>('[data-yagi-video]').forEach(video => video.pause());
    modal.showModal();
    document.documentElement.style.overflow = 'hidden';
    void playFilm(film, () => setProblem(true));
    return () => {
      film.pause();
      document.documentElement.style.overflow = previousOverflow;
      if (modal.open) modal.close();
    };
  }, [expanded]);

  function toggle() {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      manualPause.current = false;
      if (problem) video.load();
      setProblem(false);
      setWaiting(true);
      void playFilm(video, () => { setWaiting(false); setProblem(true); });
    } else { manualPause.current = true; video.pause(); }
  }
  function sound() {
    const video = ref.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    // Only one soundtrack at once; silent background films may keep playing.
    if (!video.muted) document.querySelectorAll<HTMLVideoElement>('[data-yagi-video]').forEach(other => {
      if (other !== video) { other.muted = true; other.dispatchEvent(new Event('volumechange')); }
    });
  }

  function openViewer() {
    startTime.current = ref.current?.currentTime ?? 0;
    manualPause.current = true;
    setProblem(false);
    setWaiting(false);
    setExpanded(true);
  }

  return <><div className="yagi-film" data-yagi-film data-playing={playing}>
    <video ref={ref} data-yagi-video poster={poster} aria-label={label} muted loop playsInline preload="none"
      onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); setWaiting(false); }}
      onPlaying={() => { setWaiting(false); setProblem(false); }} onWaiting={() => setWaiting(true)} onError={() => { setProblem(true); setWaiting(false); }}
      onVolumeChange={() => setMuted(ref.current?.muted ?? true)}>
      <source src={src} type="video/mp4" />
      <source src={src.replace(/\.mp4$/, '.webm')} type="video/webm" />
    </video>
    <img className="yagi-film-poster" src={poster} alt="" width="1280" height="720" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} aria-hidden="true" />
    {!expanded && (problem || waiting) && <p className="yagi-film-feedback" role="status">{problem ? labels.filmError : labels.filmLoading}</p>}
    <div className="yagi-film-controls">
      <button type="button" onClick={toggle} aria-label={`${problem ? labels.retryFilm : playing ? labels.pause : labels.play}: ${label}`} aria-pressed={playing}>
        <svg className="yagi-play-icon" viewBox="0 0 24 24" aria-hidden="true">{playing ? <><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></> : <path d="m7 4 14 8-14 8z" />}</svg>
        <span>{problem ? labels.retryFilm : playing ? labels.pause : labels.play}</span>
      </button>
      <button type="button" onClick={sound} aria-label={`${muted ? labels.soundOn : labels.soundOff}: ${label}`} aria-pressed={!muted}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />{muted ? <path d="m17 9 4 6m0-6-4 6" /> : <path d="M17 8q5 4 0 8" />}</svg>
      </button>
      <button ref={opener} type="button" onClick={openViewer} aria-haspopup="dialog" aria-controls={viewerId} aria-label={`${labels.viewFilm}: ${label}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg>
      </button>
    </div>
  </div>
    <dialog ref={dialog} id={viewerId} className="yagi-viewer" data-yagi-viewer aria-label={label}
      onClose={() => { setExpanded(false); setWaiting(false); setProblem(false); opener.current?.focus({ preventScroll: true }); }}>
      <div className="yagi-viewer-head"><p>{label}</p><button type="button" autoFocus onClick={() => dialog.current?.close()}>
        <span>{labels.closeFilm}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button></div>
      {expanded && <video ref={viewer} className="yagi-viewer-video" poster={poster} controls playsInline muted={muted} preload="none" aria-label={label}
        onLoadedMetadata={() => { const film = viewer.current; if (film && startTime.current > 0) film.currentTime = Math.min(startTime.current, Number.isFinite(film.duration) ? film.duration : startTime.current); }}
        onPlaying={() => setProblem(false)} onError={() => setProblem(true)} onVolumeChange={() => setMuted(viewer.current?.muted ?? true)}>
        <source src={src} type="video/mp4" /><source src={src.replace(/\.mp4$/, '.webm')} type="video/webm" />
      </video>}
      {expanded && problem && <div className="yagi-viewer-feedback"><p role="status">{labels.filmError}</p><button type="button" onClick={() => {
        const film = viewer.current;
        if (film) { setProblem(false); film.load(); void playFilm(film, () => setProblem(true)); }
      }}>{labels.retryFilm}</button></div>}
    </dialog>
  </>;
}
