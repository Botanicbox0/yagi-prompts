'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './brand-entry.module.css';

/** The landing's demo brand (components/brand-studio/v7.tsx): one palette through look, film and product. */
const PALETTE = ['#f3f7fa', '#d0dbe7', '#3875c5', '#2e5f9f', '#16233f'] as const;
const WALL = [
  { image: 'look-feather.webp' },
  { image: 'v7/feed-blue.jpg', film: 'v7/feed-blue.mp4' },
  { image: 'cut-flower.webp' },
  { image: 'v7/dir-clip.jpg', film: 'v7/dir-clip.mp4' },
] as const;

/**
 * Plays a sign-in wall's short films only while they are on screen. They stay on their posters under
 * prefers-reduced-motion, and the reader can pause them.
 */
export function useFilmWall() {
  const wall = useRef<HTMLDivElement>(null);
  const wanted = useRef(false);
  const onScreen = useRef(new Set<HTMLVideoElement>());
  const [playing, setPlaying] = useState(false);

  const toggle = (play: boolean) => {
    wanted.current = play;
    setPlaying(play);
    onScreen.current.forEach(film => {
      if (play) void film.play().catch(() => {});
      else film.pause();
    });
  };

  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      wanted.current = true;
      setPlaying(true);
    }
    const visible = onScreen.current;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const film = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          visible.add(film);
          if (wanted.current) void film.play().catch(() => {});
        } else {
          visible.delete(film);
          film.pause();
        }
      });
    });
    wall.current?.querySelectorAll('video').forEach(film => observer.observe(film));
    return () => observer.disconnect();
  }, []);

  return { wall, playing, toggle };
}

export function FilmPauseButton({ playing, playLabel, pauseLabel, onToggle, marker }: {
  playing: boolean;
  playLabel: string;
  pauseLabel: string;
  onToggle: (play: boolean) => void;
  marker: Record<`data-${string}`, boolean>;
}) {
  return (
    <button type="button" {...marker} className={styles.pause} aria-label={playing ? pauseLabel : playLabel} onClick={() => onToggle(!playing)}>
      {playing ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="2" /></svg>
        : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z" fill="currentColor" /></svg>}
    </button>
  );
}

/** What a brand gets, beside the sign-in door. Auth stays server-rendered; this island only plays the two short films. */
export function BrandEntryStage({ title, exampleLabel, playLabel, pauseLabel, assetOrigin, compact }: {
  title: string;
  exampleLabel: string;
  playLabel: string;
  pauseLabel: string;
  assetOrigin: string;
  /** Invited teammates already know why they are here: phones go straight to the door. */
  compact: boolean;
}) {
  const { wall, playing, toggle } = useFilmWall();
  const src = (name: string) => `${assetOrigin}/reel/landing/${name}`;

  return (
    <section data-brand-auth-stage data-compact={compact || undefined} className={styles.stage}>
      <div className={styles.stageHead}>
        <p className={styles.title}>{title}</p>
        <p data-brand-auth-kit className={styles.kit}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${assetOrigin}/brand/yagi-mark-black.png`} alt="" width={22} height={22} />
          <span className={styles.swatches} aria-hidden="true">{PALETTE.map(hex => <i key={hex} style={{ background: hex }} />)}</span>
          {exampleLabel}
        </p>
      </div>
      <FilmPauseButton playing={playing} playLabel={playLabel} pauseLabel={pauseLabel} onToggle={toggle} marker={{ 'data-brand-auth-pause': true }} />
      <div ref={wall} className={styles.wall} aria-hidden="true">
        {WALL.map((item, index) => (
          <div key={item.image} className={styles.tile} style={{ '--i': index } as CSSProperties}>
            {'film' in item
              ? <video src={src(item.film)} poster={src(item.image)} muted loop playsInline preload="metadata" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={src(item.image)} alt="" width={1000} height={1500} decoding="async" />}
          </div>
        ))}
      </div>
    </section>
  );
}
