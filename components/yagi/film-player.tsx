'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';

type Labels = Pick<Dictionary['yagi'], 'play' | 'pause' | 'soundOn' | 'soundOff'>;

/** Poster first; silent motion only in view. A manual pause persists across scrolling. */
export function FilmPlayer({ src, poster, label, labels, autoplay = false, eager = false }: {
  src: string; poster: string; label: string; labels: Labels; autoplay?: boolean; eager?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const manualPause = useRef(false);
  const visible = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function resumeIfAllowed() {
      if (!video || !autoplay || motion.matches || manualPause.current || !visible.current || document.hidden) return;
      void video.play().catch(() => undefined);
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

  function toggle() {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      manualPause.current = false;
      void video.play().catch(() => undefined);
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
  return <div className="yagi-film" data-yagi-film data-playing={playing}>
    <video ref={ref} data-yagi-video poster={poster} aria-label={label} muted loop playsInline preload="none"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onVolumeChange={() => setMuted(ref.current?.muted ?? true)}>
      <source src={src} type="video/mp4" />
      <source src={src.replace(/\.mp4$/, '.webm')} type="video/webm" />
    </video>
    <img className="yagi-film-poster" src={poster} alt="" width="1280" height="720" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} aria-hidden="true" />
    <div className="yagi-film-controls">
      <button type="button" onClick={toggle} aria-label={`${playing ? labels.pause : labels.play}: ${label}`} aria-pressed={playing}>
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><span>{playing ? labels.pause : labels.play}</span>
      </button>
      <button type="button" onClick={sound} aria-label={`${muted ? labels.soundOn : labels.soundOff}: ${label}`} aria-pressed={!muted}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />{muted ? <path d="m17 9 4 6m0-6-4 6" /> : <path d="M17 8q5 4 0 8" />}</svg>
      </button>
    </div>
  </div>;
}
