'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ReelId, ReelItem } from '@/lib/campaigns/showreel';
import styles from './brand-experience.module.css';

export interface FormatCopy {
  title: string;
  line: string;
  detail?: string;
}

export interface HeroCinemaItem {
  id: string;
  src: string;
  poster: string;
  width: number;
  height: number;
  tag: string;
  title: string;
}

export function HeroCinemaGrid({ items }: { items: readonly HeroCinemaItem[] }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = connectionInformation();
    const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video'));
    let isVisible = false;

    const sync = () => {
      const allow = !reducedOrMetered() && isVisible && !document.hidden;
      for (const v of videos) {
        if (allow) void v.play().catch(() => undefined);
        else v.pause();
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.15);
        sync();
      },
      { threshold: [0, 0.15] },
    );
    observer.observe(root);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    connection?.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      connection?.removeEventListener('change', sync);
    };
  }, []);

  return (
    <div ref={rootRef} data-hero-cinema-grid className={styles.heroCinemaGrid}>
      {items.map((item, idx) => (
        <figure key={item.id} data-hero-cinema-cell={item.id} className={styles.heroCinemaCell}>
          <video
            src={item.src}
            poster={item.poster}
            width={item.width}
            height={item.height}
            muted
            loop
            playsInline
            preload="none"
            aria-label={item.title}
            className={styles.heroCinemaVideo}
          />
          <div className={styles.heroCinemaShade} aria-hidden="true" />
          <figcaption className={styles.heroCinemaMeta}>
            <span className={styles.heroCinemaIndex}>( 0{idx + 1} ) · {item.tag}</span>
            <strong className={styles.heroCinemaTitle}>{item.title}</strong>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export interface MediaLabels {
  play: string;
  pause: string;
  formatPicker: string;
  filmLabel: string;
}

type NetworkInformation = EventTarget & {
  effectiveType?: string;
  saveData?: boolean;
};

function connectionInformation(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

function reducedOrMetered(): boolean {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const connection = connectionInformation();
  const slowConnection = connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';
  return reduced || connection?.saveData === true || slowConnection;
}

/**
 * One active film, three visible choices. No film loads before the stage enters the viewport and
 * Save-Data / reduced-motion visitors stay on the poster until they press play.
 */
export function BrandFormatExplorer({
  items,
  captions,
  labels,
}: {
  items: readonly ReelItem[];
  captions: Record<ReelId, FormatCopy>;
  labels: MediaLabels;
}) {
  const [activeId, setActiveId] = useState<ReelId>(items[0]?.id ?? 'city');
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visible = useRef(false);
  const userPaused = useRef(false);
  const canAutoplay = useRef(false);
  const active = items.find((item) => item.id === activeId) ?? items[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = connectionInformation();
    const synchronize = () => {
      const video = videoRef.current;
      if (!video) return;
      if (visible.current && canAutoplay.current && !userPaused.current && !document.hidden) void video.play().catch(() => undefined);
      else video.pause();
    };
    const updateAutoplay = () => {
      canAutoplay.current = !reducedOrMetered();
      synchronize();
    };
    updateAutoplay();
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.45);
      synchronize();
    }, { threshold: [0, 0.45] });
    observer.observe(root);
    document.addEventListener('visibilitychange', synchronize);
    motion.addEventListener('change', updateAutoplay);
    connection?.addEventListener('change', updateAutoplay);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      motion.removeEventListener('change', updateAutoplay);
      connection?.removeEventListener('change', updateAutoplay);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    userPaused.current = false;
    setPlaying(false);
    if (visible.current && canAutoplay.current && !document.hidden) void video.play().catch(() => undefined);
  }, [activeId]);

  if (!active) return null;
  const caption = captions[active.id];

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      void video.play().catch(() => undefined);
    } else {
      userPaused.current = true;
      video.pause();
    }
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.findIndex((item) => item.id === activeId);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowRight' ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    const item = items[next];
    if (!item) return;
    setActiveId(item.id);
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-format-select="${item.id}"]`)?.focus();
  }

  return (
    <div ref={rootRef} data-campaign-reel data-brand-format-explorer className={styles.formatExplorer}>
      <figure id="format-panel" role="tabpanel" aria-labelledby={`format-tab-${active.id}`} data-orientation={active.orientation} className={styles.formatStage}>
        <img src={active.poster} alt="" aria-hidden="true" className={styles.formatBackdrop} width={active.width} height={active.height} decoding="async" />
        <video
          key={active.id}
          ref={videoRef}
          src={active.src}
          poster={active.poster}
          width={active.width}
          height={active.height}
          muted
          loop
          playsInline
          preload="none"
          aria-label={caption.title}
          className={styles.formatVideo}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <div className={styles.formatShade} aria-hidden="true" />
        <div className={styles.formatTopBar} aria-hidden="true">
          <span>( 0{items.findIndex((item) => item.id === active.id) + 1} / 0{items.length} )</span>
          <span>{caption.line}</span>
        </div>
        <figcaption className={styles.formatCaption} aria-live="polite">
          <span className={styles.formatIndex}>( 0{items.findIndex((item) => item.id === active.id) + 1} )</span>
          <span>
            <strong>{caption.title}</strong>
            <small>{caption.detail ?? caption.line}</small>
          </span>
        </figcaption>
        <button data-video-control type="button" onClick={toggle} aria-pressed={playing} aria-label={`${caption.title} · ${playing ? labels.pause : labels.play}`} className={styles.videoControl}>
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          <span>{playing ? labels.pause : labels.play}</span>
        </button>
      </figure>

      <div className={styles.formatPicker} role="tablist" aria-label={labels.formatPicker} onKeyDown={move}>
        {items.map((item, index) => {
          const selected = item.id === active.id;
          const itemCopy = captions[item.id];
          return (
            <button
              id={`format-tab-${item.id}`}
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="format-panel"
              tabIndex={selected ? 0 : -1}
              data-format-select={item.id}
              className={styles.formatTab}
              onClick={() => setActiveId(item.id)}
            >
              <span className={styles.formatThumb}><img src={item.poster} alt="" width={item.width} height={item.height} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" /></span>
              <span className={styles.formatTabCopy}>
                <small>( 0{index + 1} ) · {itemCopy.line}</small>
                <strong>{itemCopy.title}</strong>
                {itemCopy.detail && <span className={styles.formatTabDetail}>{itemCopy.detail}</span>}
              </span>
              <span className={styles.formatArrow} aria-hidden="true">↗</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface CampaignFilmMedia { id: string; src: string; poster: string; width: number; height: number; postUrl?: string }

function CaseFilm({
  media,
  title,
  play,
  pause,
  active,
  onActiveChange,
  post,
}: {
  media: CampaignFilmMedia;
  title: string;
  play: string;
  pause: string;
  active: boolean;
  onActiveChange: (id: string | null) => void;
  post?: string;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;
    const pauseWhenHidden = () => {
      if (document.hidden) video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) video.pause();
    }, { threshold: 0.05 });
    observer.observe(root);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', pauseWhenHidden);
    };
  }, []);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      onActiveChange(media.id);
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      onActiveChange(null);
    }
  }

  return (
    <div><figure ref={rootRef} className={styles.caseFilm} style={{ aspectRatio: `${media.width} / ${media.height}` }} data-case-film={media.id}>
      <video ref={videoRef} src={media.src} poster={media.poster} width={media.width} height={media.height} muted controls playsInline preload="none" aria-label={title} onPlay={() => { setPlaying(true); onActiveChange(media.id); }} onPause={() => setPlaying(false)} />
      <button data-video-control type="button" aria-pressed={playing} aria-label={`${title} · ${playing ? pause : play}`} onClick={toggle}>
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><span>{playing ? pause : play}</span>
      </button>
    </figure>{media.postUrl && post && <a className={styles.postLink} href={media.postUrl} target="_blank" rel="noopener noreferrer">{post} ↗</a>}</div>
  );
}

export function MorphicFilmPair({
  media,
  labels,
}: {
  media: readonly CampaignFilmMedia[];
  labels: { readonly titles: readonly string[]; play: string; pause: string; post?: string };
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  return <div data-morphic-film-pair className={styles.morphicPair}>{media.map((item, index) => {
    const title = labels.titles[index] ?? labels.titles[0];
    return title ? <CaseFilm key={item.id} media={item} title={title} play={labels.play} pause={labels.pause} post={labels.post} active={activeId === item.id} onActiveChange={setActiveId} /> : null;
  })}</div>;
}
