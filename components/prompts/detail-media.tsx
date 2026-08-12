'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * PLAN §13.2 detail — "big media (video w/ poster, plays on view)".
 *
 * Unlike the card, the clip here is the point of the page, so the element exists from the first
 * render with its poster attached — but `preload="none"` keeps the bytes off the wire until the
 * reader has actually reached it, and an IntersectionObserver starts it then. Leaving the viewport
 * pauses it: an offscreen video decoding in a background tab is a battery bug, not a feature.
 *
 * `prefers-reduced-motion` gets controls and no autoplay — a paused first frame with a play button
 * is the honest version of "the result is right here" for a reader who asked not to be moved.
 */
export function PromptDetailMedia({
  poster,
  video,
  fallback,
  alt,
  ratio,
}: {
  poster: { src: string } | null;
  video: { src: string; mime: string } | null;
  fallback: ReactNode;
  alt: string;
  ratio: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void element.play().catch(() => {});
          else element.pause();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (video === null) {
    return poster ? (
      <div className="border border-hairline" style={{ aspectRatio: ratio }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader */}
        <img src={poster.src} alt={alt} className="h-full w-full object-cover" />
      </div>
    ) : (
      <div className="border border-hairline" style={{ aspectRatio: ratio }}>
        {fallback}
      </div>
    );
  }

  return (
    <video
      ref={ref}
      data-detail-media
      className="w-full border border-hairline object-cover"
      style={{ aspectRatio: ratio }}
      muted
      loop
      playsInline
      controls
      preload="none"
      aria-label={alt}
      {...(poster ? { poster: poster.src } : {})}
    >
      <source src={video.src} type={video.mime} />
    </video>
  );
}
