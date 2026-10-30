'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './brand-entry.module.css';

/**
 * The /brands hero film beside the sign-in door. Auth stays server-rendered; this island only plays
 * the film. It stops under prefers-reduced-motion and when off screen, and the reader can pause it.
 */
export function BrandEntryFilm({ title, filmLabel, playLabel, pauseLabel, assetOrigin }: {
  title: string;
  filmLabel: string;
  playLabel: string;
  pauseLabel: string;
  assetOrigin: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const src = (name: string) => `${assetOrigin}/reel/landing/v7/${name}`;

  useEffect(() => {
    const film = video.current;
    if (!film || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void film.play().catch(() => {});
  }, []);

  const toggle = () => {
    const film = video.current;
    if (!film) return;
    if (film.paused) void film.play().catch(() => {});
    else film.pause();
  };

  return (
    <section data-brand-auth-film className={styles.frame}>
      <video ref={video} className={styles.film} poster={src('hero.jpg')} muted loop playsInline preload="metadata"
        aria-label={filmLabel} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}>
        <source src={src('hero-720.mp4')} media="(max-width: 767px)" type="video/mp4" />
        <source src={src('hero.mp4')} type="video/mp4" />
      </video>
      <div className={styles.scrim} aria-hidden="true" />
      <h1 className={styles.title}>{title}</h1>
      <button type="button" data-brand-auth-pause className={styles.pause} aria-label={playing ? pauseLabel : playLabel} onClick={toggle}>
        {playing ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="2" /></svg>
          : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z" fill="currentColor" /></svg>}
      </button>
      <span className={styles.crosshairs} aria-hidden="true" />
    </section>
  );
}
