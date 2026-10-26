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
      {items.map((item) => (
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

/**
 * Interactive Studio Craft Stage (`data-production-craft-strip`) inspired by belgradearbor.rs
 * interactive index navigation + almirakho.com editorial contact-sheet framing + leeholmes.uk
 * "show the craft right beside the claim" persuasion architecture.
 */
export function BrandCraftShowcase({
  copy,
  locale,
}: {
  copy: CraftStripCopy;
  locale: 'ko' | 'en';
}) {
  const [activeIndex, setActiveIndex] = useState<0 | 1 | 2>(0);
  const ko = locale === 'ko';

  const pillars = [
    {
      index: 0 as const,
      code: '01',
      tag: ko ? 'COMMERCIAL LIGHTING · SKIN · TEXTURE' : 'COMMERCIAL LIGHTING · SKIN · TEXTURE',
      spec: ko ? 'GALERIES LAFAYETTE · THE HYUNDAI 기준 연출' : 'GALERIES LAFAYETTE · THE HYUNDAI GRADE',
      title: copy.lightTitle,
      body: copy.lightBody,
      thumb: '/reel/brands/production-paris.jpg',
    },
    {
      index: 1 as const,
      code: '02',
      tag: ko ? '1 SELFIE INPUT → MASTER SCENE LOCK' : '1 SELFIE INPUT → MASTER SCENE LOCK',
      spec: ko ? '조명 · 카메라 무빙 · 색보정 100% 동일 유지' : '100% LOCKED LIGHTING & CAMERA MOTION',
      title: copy.scaleTitle,
      body: copy.scaleBody,
      thumb: '/reel/studio-demo/different-person.jpg',
    },
    {
      index: 2 as const,
      code: '03',
      tag: ko ? 'KR · JP SIMULTANEOUS FEED ROLLOUT' : 'KR · JP SIMULTANEOUS FEED ROLLOUT',
      spec: ko ? '서울 · 도쿄 크리에이터 피드 동시 업로드' : 'SEOUL · TOKYO LIVE CHANNEL PUBLISHING',
      title: copy.liveTitle,
      body: copy.liveBody,
      thumb: '/reel/brands/y2k-flip-phone.jpg',
    },
  ] as const;

  const current = pillars[activeIndex];

  return (
    <div data-production-craft-strip className={styles.craftShowcase}>
      <div className={styles.craftTopBar}>
        <span className={styles.craftTopTag}>YAGI STUDIO ARCHITECTURE // 0{activeIndex + 1} — 03</span>
        <span className={styles.craftTopMeta}>
          {ko ? 'PHYSICAL SET: 0 · STUDIO GRADE: 4K MASTER · MARKETS: KR / JP' : 'PHYSICAL SET: 0 · STUDIO GRADE: 4K MASTER · MARKETS: KR / JP'}
        </span>
      </div>

      <div className={styles.craftGrid}>
        <div className={styles.craftLeft}>
          <div>
            <p className={styles.craftKicker}>
              {ko ? 'STUDIO DIRECTION × AI MEDIA SCALE' : 'STUDIO DIRECTION × AI MEDIA SCALE'}
            </p>
            <h3 className={styles.craftHeading}>{copy.heading}</h3>
            <p className={styles.craftBody}>{copy.body}</p>
          </div>

          <dl className={styles.craftList} role="tablist" aria-label={copy.heading}>
            {pillars.map((item) => {
              const isSelected = activeIndex === item.index;
              return (
                <div
                  key={item.code}
                  role="tab"
                  tabIndex={0}
                  aria-selected={isSelected}
                  data-craft-pillar={item.code}
                  data-active={isSelected ? 'true' : 'false'}
                  className={styles.craftRow}
                  onMouseEnter={() => setActiveIndex(item.index)}
                  onFocus={() => setActiveIndex(item.index)}
                  onClick={() => setActiveIndex(item.index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveIndex(item.index);
                    }
                  }}
                >
                  <div className={styles.craftRowHeader}>
                    <span className={styles.craftRowIndex}>{item.code}</span>
                    <span className={styles.craftRowTag}>{item.tag}</span>
                    <span className={styles.craftRowArrow} aria-hidden="true">↗</span>
                  </div>
                  <dt className={styles.craftRowTitle}>{item.title}</dt>
                  <dd className={styles.craftRowBody}>{item.body}</dd>
                  <div className={styles.craftProgressTrack} aria-hidden="true">
                    <span className={styles.craftProgressFill} />
                  </div>
                </div>
              );
            })}
          </dl>
        </div>

        <div className={styles.craftRight} data-craft-stage={current.code}>
          <div className={styles.craftStageFrame}>
            <div className={styles.craftStageHud}>
              <span className={styles.craftHudPill}>
                <span className={styles.craftHudDot} aria-hidden="true" />
                FRAME {current.code} // {current.tag}
              </span>
              <span className={styles.craftHudSpec}>{current.spec}</span>
            </div>

            {activeIndex === 0 && (
              <div className={styles.craftStageCanvas}>
                <div className={styles.craftPrimaryMedia}>
                  <img
                    src="/reel/brands/production-paris.jpg"
                    alt=""
                    width={1280}
                    height={720}
                    decoding="async"
                    className={styles.craftStageImg}
                  />
                  <div className={styles.craftStageOverlay} aria-hidden="true" />
                  <div className={styles.craftStageCaption}>
                    <div>
                      <span className={styles.craftMicroLabel}>
                        {ko ? 'MASTER FILM DIRECTION' : 'MASTER FILM DIRECTION'}
                      </span>
                      <strong className={styles.craftCaptionTitle}>
                        {ko ? '갤러리 라파예트 · 더현대 하이패션 연출 기준' : 'Galeries Lafayette & The Hyundai Commercial Direction'}
                      </strong>
                    </div>
                    <div className={styles.craftSpecChips}>
                      <span>OPTICAL LENS FLARE</span>
                      <span>SKIN MICRO-TEXTURE</span>
                      <span>FABRIC DRAPE</span>
                    </div>
                  </div>
                </div>
                <div className={styles.craftDetailPair}>
                  <div className={styles.craftDetailCard}>
                    <img src="/reel/campaigns/beauty-rose.jpg" alt="" width={640} height={360} loading="lazy" decoding="async" />
                    <div>
                      <span>01A · BEAUTY MACRO</span>
                      <strong>{ko ? '수분감 · 피부 결 · 조명 반사 제어' : 'Specular Skin & Product Lighting'}</strong>
                    </div>
                  </div>
                  <div className={styles.craftDetailCard}>
                    <img src="/reel/brands/city-fashion.jpg" alt="" width={640} height={480} loading="lazy" decoding="async" />
                    <div>
                      <span>01B · EDITORIAL LOOK</span>
                      <strong>{ko ? '로케이션 대관 없는 시네마틱 미장센' : 'Location-Grade Editorial Staging'}</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeIndex === 1 && (
              <div className={styles.craftStageCanvas}>
                <div className={styles.craftCompareGrid}>
                  <div className={styles.craftCompareBox}>
                    <span className={styles.craftCompareBadge}>
                      {ko ? 'INPUT · 크리에이터 셀카 1장' : 'INPUT · 1 CREATOR SELFIE'}
                    </span>
                    <img
                      src="/reel/studio-demo/reference-selfie.jpeg"
                      alt=""
                      width={640}
                      height={800}
                      decoding="async"
                      className={styles.craftCompareImg}
                    />
                    <p className={styles.craftCompareFoot}>
                      {ko ? '오프라인 촬영 · 제품 배송 없음' : 'Zero Studio Shoot · Zero Product Shipping'}
                    </p>
                  </div>
                  <div className={styles.craftCompareConnector} aria-hidden="true">
                    <span>AI LOCK</span>
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                    <span>100%</span>
                  </div>
                  <div className={styles.craftCompareBox}>
                    <span className={styles.craftCompareBadgeAccent}>
                      {ko ? 'OUTPUT · 마스터 필름 속 주인공' : 'OUTPUT · STARRING IN MASTER FILM'}
                    </span>
                    <img
                      src="/reel/studio-demo/different-person.jpg"
                      alt=""
                      width={640}
                      height={800}
                      decoding="async"
                      className={styles.craftCompareImg}
                    />
                    <p className={styles.craftCompareFoot}>
                      {ko ? '마스터 조명 · 앵글 · 감도 100% 보존' : 'Exact Master Lighting, Lens & Grade Preserved'}
                    </p>
                  </div>
                </div>
                <div className={styles.craftDetailPair}>
                  <div className={styles.craftDetailCard}>
                    <img src="/reel/campaigns/highteen.jpg" alt="" width={400} height={500} loading="lazy" decoding="async" />
                    <div>
                      <span>FORMAT A · HIGHTEEN FILM</span>
                      <strong>{ko ? '누가 참여하든 동일한 연출 품질' : 'Consistent Across Every Creator'}</strong>
                    </div>
                  </div>
                  <div className={styles.craftDetailCard}>
                    <img src="/reel/brands/y2k-flip-phone.jpg" alt="" width={400} height={500} loading="lazy" decoding="async" />
                    <div>
                      <span>FORMAT B · Y2K FEED CUT</span>
                      <strong>{ko ? '수십 명의 버전으로 즉시 복제·확장' : 'Instant Multi-Creator Replication'}</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeIndex === 2 && (
              <div className={styles.craftStageCanvas}>
                <div className={styles.craftFeedMatrix}>
                  {[
                    {
                      market: 'KR · SEOUL',
                      channel: 'IG REELS · TIKTOK',
                      img: '/reel/brands/y2k-flip-phone.jpg',
                      title: ko ? 'Y2K 제품 쇼케이스 피드' : 'Y2K Product Feed Drop',
                    },
                    {
                      market: 'JP · TOKYO',
                      channel: 'IG REELS · X',
                      img: '/reel/brands/morphic-september-01.jpg',
                      title: ko ? '한·일 동시 캠페인 릴스' : 'KR·JP Simultaneous Reels',
                    },
                    {
                      market: 'KR ·JP SYNC',
                      channel: 'VERIFIED REPORT',
                      img: '/reel/campaigns/beauty-rose.jpg',
                      title: ko ? '뷰티·패션 오가닉 확산' : 'Beauty & Fashion Organic Reach',
                    },
                  ].map((card) => (
                    <div key={card.market} className={styles.craftFeedCard}>
                      <div className={styles.craftFeedMedia}>
                        <img src={card.img} alt="" width={480} height={640} loading="lazy" decoding="async" />
                        <span className={styles.craftFeedMarket}>{card.market}</span>
                      </div>
                      <div className={styles.craftFeedMeta}>
                        <span>{card.channel}</span>
                        <strong>{card.title}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className={styles.craftMetricsBar}>
                  <div>
                    <span>{ko ? 'PROVEN SEED FILMS' : 'PROVEN SEED FILMS'}</span>
                    <strong>{ko ? '영상 9편' : '9 Seed Films'}</strong>
                  </div>
                  <div>
                    <span>{ko ? 'CAMPAIGN REACH' : 'CAMPAIGN REACH'}</span>
                    <strong>{ko ? '200만 뷰+' : '2M+ Views'}</strong>
                  </div>
                  <div>
                    <span>{ko ? 'ORGANIC DERIVATIVES' : 'ORGANIC DERIVATIVES'}</span>
                    <strong>{ko ? '파생 콘텐츠 300건+' : '300+ Organic Posts'}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className={styles.craftContactSheet} aria-label="Contact sheet">
              {pillars.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setActiveIndex(item.index)}
                  data-contact-thumb={item.code}
                  data-active={activeIndex === item.index ? 'true' : 'false'}
                  className={styles.craftContactThumb}
                >
                  <img src={item.thumb} alt="" width={160} height={100} loading="lazy" decoding="async" />
                  <div>
                    <span>FRAME {item.code}</span>
                    <strong>{item.title}</strong>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
