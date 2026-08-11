'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useIsomorphicLayoutEffect } from '@/components/motion/use-isomorphic-layout-effect';

/**
 * PLAN §5.3-1 — "full-viewport pinned sections, scroll-scrubbed internals (landing 'How it reads',
 * 3 panels). ≥1024 only."
 *
 * This is the one place that spends the §5.4 pin budget: ScrollTrigger owns the pin, `gsap.matchMedia`
 * owns the ≥1024 + `no-preference` gate, and the panels contain nothing sticky and never the ad
 * rail (which is a root-level portal precisely so this pin cannot drag it around).
 *
 * Below 1024, or under reduced motion, the callback never runs: the three panels are three blocks
 * in normal document order, in the same words. That is the whole degradation story.
 */

export interface ReadingPanel {
  index: string;
  title: string;
  body: string;
}

export function HowItReads({
  eyebrow,
  title,
  panels,
}: {
  eyebrow: string;
  title: string;
  panels: ReadingPanel[];
}) {
  const sceneRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const slides = gsap.utils.toArray<HTMLElement>('[data-panel]', scene);
      if (slides.length < 2) return;

      gsap.set(slides, { position: 'absolute', inset: 0 });
      // `opacity`, not `autoAlpha`: autoAlpha also flips `visibility: hidden`, which would drop
      // panels 2 and 3 out of the accessibility tree and out of a crawler's rendered text until
      // someone scrolls. The panels are prose; they should be readable in document order.
      gsap.set(slides.slice(1), { opacity: 0, yPercent: 10 });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: scene,
          start: 'top top',
          end: () => `+=${slides.length * 100}%`,
          pin: true,
          scrub: 0.5,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      slides.forEach((slide, index) => {
        if (index === 0) return;
        timeline
          .to(
            slides[index - 1]!,
            { opacity: 0, yPercent: -10, ease: 'power2.inOut', duration: 1 },
            index - 1,
          )
          .to(slide, { opacity: 1, yPercent: 0, ease: 'power2.inOut', duration: 1 }, index - 1);
      });
    });

    return () => mm.revert();
  }, [panels.length]);

  return (
    <section data-section data-theme="light" className="section" aria-labelledby="how-it-reads">
      <div ref={sceneRef} className="relative lg:h-screen">
        <div className="band pt-24 lg:absolute lg:inset-x-0 lg:top-0 lg:z-10 lg:pt-28">
          <p className="text-accent font-label text-eyebrow uppercase">{eyebrow}</p>
          <h2 id="how-it-reads" className="sr-only">
            {title}
          </h2>
        </div>

        {panels.map((panel) => (
          <div key={panel.index} data-panel className="panel band py-14 lg:py-0">
            <div className="w-full max-w-detail">
              <p className="text-accent font-mono text-code">
                {panel.index} <span aria-hidden>/ {String(panels.length).padStart(2, '0')}</span>
              </p>
              <h3 className="mt-5 font-display text-title font-black uppercase">{panel.title}</h3>
              <p className="mt-6 text-body opacity-80">{panel.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
