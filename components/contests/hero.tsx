'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useIsomorphicLayoutEffect } from '@/components/motion/use-isomorphic-layout-effect';

/**
 * PLAN §14.2 — "detail = full-bleed hero", on §5.3-8's move: "scales 1.05→1.0 + parallax on first
 * scroll (desktop); plain block on mobile".
 *
 * The same contract as `components/landing/hero-media.tsx`, and the same two boundaries:
 *   · `(min-width: 1024px)` — §5.3 keeps every scrub off the small tiers, so on a phone this is a
 *     plain image in a box;
 *   · `prefers-reduced-motion: no-preference` — a scrub is precisely what the reduced-motion
 *     setting exists to switch off, so `matchMedia` never runs the callback and nothing moves.
 *
 * The media is painted at full opacity from the first frame and only `transform` animates, so it
 * stays a valid, early LCP candidate — a contest poster IS the page's largest paint.
 *
 * No pin: §5.4 gives ScrollTrigger's pin budget to the landing's "How it reads" scene, and a second
 * pin-spacer on a detail page would fight the sticky nav for the same pixels.
 *
 * **The scrub runs on real media only**, and that is a fix rather than a shortcut. The move starts
 * at `scale: 1.05`, so at rest the frame is 5% overscanned — invisible on a photograph, and on the
 * TYPOGRAPHIC fallback it clips the title against the left edge before the reader has scrolled at
 * all. A composition made of type is not something to crop; it renders at 1:1 and stays still.
 */
export function ContestHero({
  poster,
  video,
  alt,
  fallback,
}: {
  poster: { src: string } | null;
  video: { src: string; mime: string } | null;
  alt: string;
  /** The server-rendered typographic poster, used when nothing has been published yet. */
  fallback: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const hasMedia = poster !== null || video !== null;

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner || !hasMedia) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(
        inner,
        { scale: 1.05, yPercent: 0 },
        {
          scale: 1,
          yPercent: 6,
          ease: 'none',
          scrollTrigger: { trigger: root, start: 'top 12%', end: 'bottom top', scrub: 0.6 },
        },
      );
    });

    return () => mm.revert();
  }, [hasMedia]);

  return (
    <div ref={rootRef} data-contest-hero className="overflow-hidden border-b border-hairline">
      {/* 4:5 below 640, not 4:3 (M9 design review, finding 1): the typographic poster is a real
          composition at every tier, and a landscape band at phone width leaves it ~90px of black to
          set a three-line title and a prize panel in. Portrait is the format a poster is. */}
      <div ref={innerRef} className="aspect-4/5 w-full sm:aspect-16/9 lg:aspect-21/9">
        {video ? (
          <video
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={alt}
            {...(poster ? { poster: poster.src } : {})}
          >
            <source src={video.src} type={video.mime} />
          </video>
        ) : poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader
          <img src={poster.src} alt={alt} className="h-full w-full object-cover" />
        ) : (
          fallback
        )}
      </div>
    </div>
  );
}
