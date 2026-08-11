'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useIsomorphicLayoutEffect } from '@/components/motion/use-isomorphic-layout-effect';
import { coveringCircleDiameter } from '@/lib/motion/geometry';

/**
 * PLAN §5.3-2 — "circle scales to flip black↔white between inverse sections. Once or twice max.
 * ≥1024; fade below."
 *
 * This is the page's ONE wipe, and it sits exactly where the rhythm inverts: the white
 * "How it reads" scene into the black featured strip.
 *
 * Three states, in strictly decreasing capability:
 *   · `off`    — the server render and any browser without JS: a plain black block, i.e. the
 *                honest end state of a white→black inversion.
 *   · `fade`   — <1024 or reduced motion: the black layer cross-fades in on entry.
 *   · `circle` — ≥1024 with motion: a scrubbed circle, sized to cover the strip corner to corner.
 */
export function CircleWipe({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    const ink = inkRef.current;
    if (!root || !ink) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();

    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      root.dataset.anim = 'circle';

      const size = () => {
        const rect = root.getBoundingClientRect();
        root.style.setProperty(
          '--wipe-d',
          `${coveringCircleDiameter(window.innerWidth, rect.height)}px`,
        );
      };
      size();

      const tween = gsap.fromTo(
        ink,
        { scale: 0 },
        {
          scale: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: root,
            start: 'top bottom',
            end: 'bottom bottom',
            scrub: 0.4,
            invalidateOnRefresh: true,
            onRefresh: size,
          },
        },
      );

      return () => {
        tween.kill();
        delete root.dataset.anim;
        root.style.removeProperty('--wipe-d');
      };
    });

    mm.add(
      '(max-width: 1023px), (prefers-reduced-motion: reduce)',
      () => {
        root.dataset.anim = 'fade';
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (entry?.isIntersecting) root.dataset.shown = 'true';
          },
          { threshold: 0.25 },
        );
        observer.observe(root);
        return () => {
          observer.disconnect();
          delete root.dataset.anim;
          delete root.dataset.shown;
        };
      },
    );

    return () => mm.revert();
  }, []);

  return (
    <div
      ref={rootRef}
      data-anim="off"
      aria-hidden
      /* The strip is a themed SECTION as far as the nav and the ad rail are concerned (§4): it
         ends black, so chrome passing over it reads dark. Without this it is a hole in the
         section list and the probe-line observers fall back to their initial value mid-page. */
      data-section
      data-theme="dark"
      className={['wipe h-[28svh] min-h-40 lg:h-[45vh]', className].filter(Boolean).join(' ')}
    >
      <span ref={inkRef} className="wipe__ink" />
    </div>
  );
}
