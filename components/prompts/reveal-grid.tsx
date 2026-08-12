'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useIsomorphicLayoutEffect } from '@/components/motion/use-isomorphic-layout-effect';

/**
 * PLAN §5.3 motion budget, calm tier — "reveals ≤400ms" — applied to the masonry wall.
 *
 * The rule this follows is the same one `components/motion/reveal.tsx` follows and it is the one
 * that matters: **the hidden state is armed in a layout effect, never in the HTML or the
 * stylesheet.** A static, cached, SEO-bearing gallery must ship visible cards; if GSAP never loads,
 * if a chunk fails, if the reader has reduced motion on, the wall is simply there.
 *
 * `gsap.matchMedia` owns the reduced-motion branch, so under `prefers-reduced-motion: reduce` the
 * callback never runs and nothing is ever hidden — not a shortened animation, none at all.
 */
export function RevealGrid({
  children,
  className,
  stagger = 0.06,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  const ref = useRef<HTMLUListElement>(null);

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const targets = root.querySelectorAll('[data-prompt-item]');
      if (targets.length === 0) return;

      gsap.fromTo(
        targets,
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4, // §5.3: the calm tier's ceiling, not a suggestion
          ease: 'power2.out',
          stagger,
          scrollTrigger: { trigger: root, start: 'top 88%', once: true },
        },
      );
    });

    return () => mm.revert();
  }, [stagger]);

  return (
    <ul ref={ref} className={className}>
      {children}
    </ul>
  );
}
