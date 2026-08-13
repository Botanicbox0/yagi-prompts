'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * PLAN §13.2 — "hover video autoplay muted (video only loads on hover/intersection — perf)".
 *
 * The `<video>` element is not in the tree until the card is ARMED, and the `src` is not set until
 * then either, so a gallery of forty cards downloads forty posters and zero videos. Arming happens
 * on the gesture that matches the device:
 *
 *   · pointer:fine (mouse/trackpad) → `pointerenter`, and it pauses + rewinds on leave, so a
 *     40-card wall never has more than one clip decoding;
 *   · no hover (touch) → IntersectionObserver at 60%, because there is no hover to wait for and a
 *     card the reader has deliberately scrolled to is the closest thing to intent;
 *   · `prefers-reduced-motion` → never. §5.3's reduced-motion rule is a kill switch, not a
 *     softening, and an autoplaying clip is exactly what it exists to stop.
 *
 * The poster stays mounted underneath at all times: it is the LCP candidate, it is what a browser
 * with no JS shows, and it is what fills the frame while the first video frame decodes.
 */

export interface CardMediaSource {
  src: string;
  mime: string;
  w?: number;
  h?: number;
}

export function PromptCardMedia({
  poster,
  video,
  fallback,
  alt,
  ratio,
  className,
}: {
  poster: CardMediaSource | null;
  video: CardMediaSource | null;
  /** The typographic poster (§13.3-4), rendered on the server and handed down. */
  fallback: ReactNode;
  alt: string;
  ratio: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);

  // Touch tier: arm on real visibility. Set up once, and only when there is a clip to arm.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || video === null || armed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setArmed(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [video, armed]);

  const arm = () => {
    if (video === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setArmed(true);
    // Already mounted from a previous hover — just resume.
    void videoRef.current?.play().catch(() => {});
  };

  const disarm = () => {
    const element = videoRef.current;
    if (!element) return;
    element.pause();
    element.currentTime = 0;
  };

  return (
    <div
      ref={rootRef}
      onPointerEnter={arm}
      onPointerLeave={disarm}
      onFocus={arm}
      onBlur={disarm}
      data-armed={armed ? 'true' : 'false'}
      /* Black ground: the card is a fixed 16:9 window (founder 2026-08-14) and a portrait result
         is letterboxed into it, so the bars are part of the design rather than a gap. */
      className={['card__media relative overflow-hidden bg-black', className].filter(Boolean).join(' ')}
      style={{ aspectRatio: ratio }}
    >
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader
        <img
          src={poster.src}
          alt={alt}
          {...(poster.w ? { width: poster.w } : {})}
          {...(poster.h ? { height: poster.h } : {})}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        fallback
      )}

      {armed && video !== null && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-contain"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          tabIndex={-1}
        >
          <source src={video.src} type={video.mime} />
        </video>
      )}
    </div>
  );
}
