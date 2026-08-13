'use client';

import { useRef, type ElementType } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect';

/**
 * PLAN §5.3-4 — "clip-path mask reveal, 80ms stagger" on display lines.
 *
 * The hidden state is armed in a layout effect (`data-reveal="armed"`), never in the HTML, so the
 * static page always ships readable copy. `gsap.matchMedia` owns the reduced-motion branch: under
 * `prefers-reduced-motion: reduce` the callback never runs and the lines simply stay visible —
 * §5.3's "scrubs → fades, pins off" read at its strictest, which for a reveal means *no* reveal.
 *
 * `immediate` is the hero: it plays on mount instead of on a scroll trigger, so the first screen
 * is not waiting for a scroll that may never come.
 */
export function Reveal({
  lines,
  as: Tag = 'h2',
  className,
  lineClassName,
  immediate = false,
  delay = 0,
}: {
  lines: string[];
  as?: ElementType;
  className?: string;
  lineClassName?: string;
  immediate?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const targets = root.querySelectorAll('[data-reveal-line]');
      if (targets.length === 0) return;

      root.dataset.reveal = 'armed';
      // `fromTo`, not `to`: both clip-path strings are authored here with the same four values, so
      // GSAP interpolates them instead of choking on the browser's normalised 3-value computed form.
      gsap.fromTo(
        targets,
        { clipPath: 'inset(0% 0% 100% 0%)', y: 14 },
        {
          clipPath: 'inset(0% 0% -4% 0%)',
          y: 0,
          duration: 0.85,
          ease: 'expo.out',
          stagger: 0.08, // §5.3-4: 80ms
          delay,
          ...(immediate
            ? {}
            : { scrollTrigger: { trigger: root, start: 'top 85%', once: true } }),
        },
      );

      return () => {
        delete root.dataset.reveal;
      };
    });

    return () => mm.revert();
  }, [immediate, delay]);

  return (
    <Tag ref={ref} className={className}>
      {/* Empty strings are legal input — a locale may need fewer display lines than its twin. */}
      {lines.filter(Boolean).map((line, index) => (
        <span
          key={`${index}-${line}`}
          data-reveal-line
          className={lineClassName}
        >
          {line}
        </span>
      ))}
    </Tag>
  );
}

/**
 * PLAN §5.3-4, second half — "section titles scrub-translate ±40px".
 *
 * Scrub only, so it is a pure scroll-linked transform with no state; ≥1024 because §5.3 keeps
 * every scrub off the small tiers, and motion-only because a scrub is exactly what
 * `prefers-reduced-motion` asks us to drop.
 */
export function ScrubY({
  children,
  distance = 40,
  className,
}: {
  children: React.ReactNode;
  distance?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(
        el,
        { y: distance },
        {
          y: -distance,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
    });

    return () => mm.revert();
  }, [distance]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
