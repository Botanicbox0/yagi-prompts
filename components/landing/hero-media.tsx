'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useIsomorphicLayoutEffect } from '@/components/motion/use-isomorphic-layout-effect';
import type { MediaSlot } from '@/lib/content/slots';

/**
 * PLAN §5.3-8 — "hero visual scales 1.05→1.0 + parallax on first scroll (desktop); plain block on
 * mobile".
 *
 * Interpretation logged for the Director: §5.3 titles this move "pinned hero media", but the
 * behaviour it specifies is the scale + parallax scrub, and §5.4 gives ScrollTrigger's pin budget
 * to the "How it reads" scene. A second pin on the first screen would fight that one's pin-spacer
 * and delay the LCP element, so the hero gets the scrub and no pin.
 *
 * The media element is painted at full opacity from the first frame — only `transform` animates —
 * so it stays a valid, early LCP candidate.
 *
 * `<video>` is wired but source-optional: `HERO_REEL.src` is null until content-ops publishes the
 * HyperFrames render (docs/CONTENT-SLOTS.md), and the poster composition renders instead.
 */
export function HeroMedia({
  reel,
  label,
  poster,
}: {
  reel: MediaSlot;
  label: string;
  poster: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(
        inner,
        { scale: 1.05, yPercent: 0 },
        {
          scale: 1,
          yPercent: 8,
          ease: 'none',
          scrollTrigger: {
            trigger: root,
            start: 'top 15%',
            end: 'bottom top',
            scrub: 0.6,
          },
        },
      );
    });

    return () => mm.revert();
  }, []);

  return (
    <div ref={rootRef} className="overflow-hidden border border-hairline">
      <div ref={innerRef} className="aspect-4/3 w-full lg:aspect-16/10">
        {reel.src ? (
          <video
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={label}
            {...(reel.poster ? { poster: reel.poster } : {})}
          >
            <source src={reel.src} type={reel.type} />
          </video>
        ) : (
          poster
        )}
      </div>
    </div>
  );
}
