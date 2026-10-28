'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './landing.module.css';

/**
 * Brand landing v5, the only moving parts: a muted loop that plays while it is on screen (poster-first,
 * nothing downloads until it is near the viewport) and the asset tabs. Both stop under reduced motion.
 */

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function LoopVideo({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || prefersReducedMotion()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        if (video.preload !== 'auto') video.preload = 'auto';
        void video.play().catch(() => {});
      } else video.pause();
    }, { rootMargin: '120px 0px' });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-label={label}
      data-loop-video
    />
  );
}

export function AssetTabs({ labels, panels }: { labels: readonly string[]; panels: readonly ReactNode[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + labels.length) % labels.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div data-asset-tabs className={styles.panel}>
      <div role="tablist" aria-label={labels.join(' · ')} className={styles.tabs}>
        {labels.map((label, index) => (
          <button
            key={label}
            ref={(node) => { refs.current[index] = node; }}
            id={`asset-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={active === index}
            aria-controls={`asset-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => move(event, index)}
            className={styles.tab}
          >
            {label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div key={labels[index]} role="tabpanel" id={`asset-panel-${index}`} aria-labelledby={`asset-tab-${index}`} hidden={active !== index} data-asset-panel={index} className={styles.panel}>
          {panel}
        </div>
      ))}
    </div>
  );
}
