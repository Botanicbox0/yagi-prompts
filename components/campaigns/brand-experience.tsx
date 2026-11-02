'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ReelId, ReelItem } from '@/lib/campaigns/showreel';
import styles from './brand-experience.module.css';

export interface FormatCopy {
  title: string;
  line: string;
}

export interface HeroCinemaItem {
  id: string;
  src: string;
  poster: string;
  width: number;
  height: number;
  title: string;
}

function playMutedVideo(v: HTMLVideoElement) {
  v.defaultMuted = true;
  v.muted = true;
  void v.play().catch(() => undefined);
}

export function HeroCinemaGrid({ items }: { items: readonly HeroCinemaItem[] }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const connection = connectionInformation();
    const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video'));
    let isVisible = true;

    const sync = () => {
      const allow = !reducedOrMetered() && isVisible && !document.hidden;
      for (const v of videos) {
        if (allow) playMutedVideo(v);
        else v.pause();
      }
    };

    sync();

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.1);
        sync();
      },
      { threshold: [0, 0.1] },
    );
    observer.observe(root);
    document.addEventListener('visibilitychange', sync);
    connection?.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      connection?.removeEventListener('change', sync);
    };
  }, []);

  return (
    <div ref={rootRef} data-hero-cinema-grid className={styles.heroCinemaGrid}>
      {items.map((item) => (
        <figure key={item.id} data-hero-cinema-cell={item.id} className={styles.heroCinemaCell}>
          <video
            src={item.src}
            poster={item.poster}
            width={item.width}
            height={item.height}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={item.title}
            className={styles.heroCinemaVideo}
          />
          <div className={styles.heroCinemaShade} aria-hidden="true" />
          <figcaption className={styles.heroCinemaMeta}>
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
  const connection = connectionInformation();
  const slowConnection = connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';
  return connection?.saveData === true || slowConnection;
}

/**
 * One active film, three visible choices. No film loads before the stage enters the viewport and
 * Save-Data visitors stay on the poster until they press play.
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
  const canAutoplay = useRef(true);
  const active = items.find((item) => item.id === activeId) ?? items[0];

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const connection = connectionInformation();
    const synchronize = () => {
      const video = videoRef.current;
      if (!video) return;
      if (visible.current && canAutoplay.current && !userPaused.current && !document.hidden) playMutedVideo(video);
      else video.pause();
    };
    const updateAutoplay = () => {
      canAutoplay.current = !reducedOrMetered();
      synchronize();
    };
    updateAutoplay();
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.15);
      synchronize();
    }, { threshold: [0, 0.15] });
    observer.observe(root);
    document.addEventListener('visibilitychange', synchronize);
    connection?.addEventListener('change', updateAutoplay);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      connection?.removeEventListener('change', updateAutoplay);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    userPaused.current = false;
    setPlaying(false);
    if (visible.current && canAutoplay.current && !document.hidden) playMutedVideo(video);
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
          autoPlay
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
        <figcaption className={styles.formatCaption} aria-live="polite">
          <span>
            <strong>{caption.title}</strong>
            <small>{caption.line}</small>
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
                <strong>{itemCopy.title}</strong>
                <span className={styles.formatTabDetail}>{itemCopy.line}</span>
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
  const userPaused = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;
    const pauseWhenHidden = () => {
      if (document.hidden) video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.2 && !userPaused.current && !reducedOrMetered()) {
        playMutedVideo(video);
      } else if (!entry?.isIntersecting) {
        video.pause();
      }
    }, { threshold: [0, 0.2] });
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
      userPaused.current = false;
      onActiveChange(media.id);
      playMutedVideo(video);
    } else {
      userPaused.current = true;
      video.pause();
      onActiveChange(null);
    }
  }

  return (
    <div><figure ref={rootRef} className={styles.caseFilm} style={{ aspectRatio: `${media.width} / ${media.height}` }} data-case-film={media.id}>
      <video ref={videoRef} src={media.src} poster={media.poster} width={media.width} height={media.height} autoPlay muted loop controls playsInline preload="none" aria-label={title} onPlay={() => { setPlaying(true); onActiveChange(media.id); }} onPause={() => setPlaying(false)} />
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

export interface CraftStripCopy {
  heading: string;
  body: string;
  lightTitle: string;
  lightBody: string;
  scaleTitle: string;
  scaleBody: string;
  liveTitle: string;
  liveBody: string;
}

type CraftIndex = 0 | 1 | 2;

function syncStageVideos(root: HTMLElement, visible: boolean) {
  const allow = visible && !document.hidden && !reducedOrMetered();
  for (const video of Array.from(root.querySelectorAll<HTMLVideoElement>('video'))) {
    if (allow) playMutedVideo(video);
    else video.pause();
  }
}

/**
 * Split craft stage (`data-production-craft-strip`): a quiet 01 / 02 / 03 index on the left, one
 * edge-to-edge cinematic frame on the right. Hover, focus or a thumb press swaps the frame; stage
 * video only loads once it is on screen and stays on the poster for Save-Data.
 */
export function BrandCraftShowcase({
  copy,
  locale,
}: {
  copy: CraftStripCopy;
  locale: 'ko' | 'en';
}) {
  const [activeIndex, setActiveIndex] = useState<CraftIndex>(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const ko = locale === 'ko';

  const pillars = [
    { index: 0, code: '01', title: copy.lightTitle, body: copy.lightBody, thumb: '/reel/brands/production-paris.jpg' },
    { index: 1, code: '02', title: copy.scaleTitle, body: copy.scaleBody, thumb: '/reel/studio-demo/different-person.jpg' },
    { index: 2, code: '03', title: copy.liveTitle, body: copy.liveBody, thumb: '/reel/brands/y2k-flip-phone.jpg' },
  ] as const;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const connection = connectionInformation();
    const sync = () => syncStageVideos(stage, visible.current);
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.15);
      sync();
    }, { threshold: [0, 0.15] });
    observer.observe(stage);
    document.addEventListener('visibilitychange', sync);
    connection?.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      connection?.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage) syncStageVideos(stage, visible.current);
  }, [activeIndex]);

  const current = pillars[activeIndex];

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = (event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowDown' ? (activeIndex + 1) % 3 : (activeIndex + 2) % 3) as CraftIndex;
    setActiveIndex(next);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-craft-pillar="${pillars[next].code}"]`)?.focus();
  }

  return (
    <div data-production-craft-strip className={styles.craftShowcase}>
      <div className={styles.craftGrid}>
        <div className={styles.craftLeft}>
          <div>
            <h3 className={styles.craftHeading}>{copy.heading}</h3>
            <p className={styles.craftBody}>{copy.body}</p>
          </div>

          <div ref={listRef} role="tablist" aria-orientation="vertical" aria-label={copy.heading} className={styles.craftList} onKeyDown={move}>
            {pillars.map((item) => {
              const selected = activeIndex === item.index;
              return (
                <button
                  key={item.code}
                  id={`craft-tab-${item.code}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="craft-stage"
                  tabIndex={selected ? 0 : -1}
                  data-craft-pillar={item.code}
                  data-active={selected ? 'true' : 'false'}
                  className={styles.craftRow}
                  onMouseEnter={() => setActiveIndex(item.index)}
                  onFocus={() => setActiveIndex(item.index)}
                  onClick={() => setActiveIndex(item.index)}
                >
                  <span className={styles.craftRowHead}>
                    <span className={styles.craftRowIndex}>{item.code}</span>
                    <span className={styles.craftRowTitle}>{item.title}</span>
                    <span className={styles.craftRowRule} aria-hidden="true" />
                  </span>
                  <span className={styles.craftRowReveal}>
                    <span className={styles.craftRowBody}>
                      <span className={styles.craftRowText}>{item.body}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.craftRight}>
          <div ref={stageRef} id="craft-stage" role="tabpanel" aria-labelledby={`craft-tab-${current.code}`} data-craft-stage={current.code} className={styles.craftStage}>
            <div key={current.code} className={styles.craftLayer}>
              {activeIndex === 0 && (
                <video
                  src="/reel/brands/production-paris.mp4"
                  poster="/reel/brands/production-paris.jpg"
                  width={1280}
                  height={720}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={current.title}
                  className={styles.craftMedia}
                />
              )}

              {activeIndex === 1 && (
                <div className={styles.craftSplit}>
                  <figure className={styles.craftCell}>
                    <img
                      src="/reel/studio-demo/reference-selfie.jpeg"
                      alt={ko ? '크리에이터 셀카' : 'Creator selfie'}
                      width={640}
                      height={800}
                      decoding="async"
                      className={`${styles.craftMedia} ${styles.craftMediaTop}`}
                    />
                    <figcaption className={styles.craftLabel}>{ko ? '셀카 1장' : 'Selfie'}</figcaption>
                  </figure>
                  <figure className={styles.craftCell}>
                    <video
                      src="/reel/studio-demo/different-person.mp4"
                      poster="/reel/studio-demo/different-person.jpg"
                      width={720}
                      height={900}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      aria-label={current.title}
                      className={`${styles.craftMedia} ${styles.craftMediaTop}`}
                    />
                    <figcaption className={styles.craftLabel}>{ko ? '완성 장면' : 'Scene'}</figcaption>
                  </figure>
                  <span className={styles.craftArrow} aria-hidden="true">→</span>
                </div>
              )}

              {activeIndex === 2 && (
                <div className={styles.craftSplit}>
                  <figure className={styles.craftCell}>
                    <video
                      src="/reel/brands/y2k-flip-phone.mp4"
                      poster="/reel/brands/y2k-flip-phone.jpg"
                      width={720}
                      height={1280}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      aria-label={current.title}
                      className={`${styles.craftMedia} ${styles.craftMediaTop}`}
                    />
                  </figure>
                  <figure className={styles.craftCell}>
                    <img
                      src="/reel/brands/morphic-september-01.jpg"
                      alt=""
                      width={960}
                      height={720}
                      decoding="async"
                      className={styles.craftMedia}
                    />
                  </figure>
                </div>
              )}
            </div>
          </div>

          <div className={styles.craftThumbs}>
            {pillars.map((item) => {
              const selected = activeIndex === item.index;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setActiveIndex(item.index)}
                  data-contact-thumb={item.code}
                  data-active={selected ? 'true' : 'false'}
                  aria-pressed={selected}
                  aria-label={item.title}
                  className={styles.craftThumb}
                >
                  <img src={item.thumb} alt="" width={160} height={100} loading="lazy" decoding="async" />
                  <span>{item.code}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
