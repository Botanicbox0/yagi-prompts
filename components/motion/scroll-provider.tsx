'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * PLAN §5.4 — the motion shell. Scenes land in M1; this file owns the CONTRACT.
 *
 *   · Lenis runs in NATIVE-SCROLL mode (no wrapper transform), so `position: sticky` and
 *     `position: fixed` stay valid — the sticky step index and the root-portal ad rail depend on it.
 *   · ScrollTrigger owns pins. It is wired to Lenis through `scrollerProxy` exactly ONCE, here.
 *   · `prefers-reduced-motion` is a hard kill switch: Lenis never initialises, ScrollTrigger is
 *     never registered, and scroll stays fully native.
 *   · `lagSmoothing(0)` — GSAP must not "catch up" after a stall while it drives Lenis' RAF.
 */

interface ScrollContextValue {
  lenis: Lenis | null;
  reducedMotion: boolean;
}

const ScrollContext = createContext<ScrollContextValue>({ lenis: null, reducedMotion: false });

export function useScroll(): ScrollContextValue {
  return useContext(ScrollContext);
}

export function ScrollProvider({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);
  const [value, setValue] = useState<ScrollContextValue>({ lenis: null, reducedMotion: false });

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');

    const teardown = () => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      ScrollTrigger.clearScrollMemory();
      gsap.ticker.remove(tick);
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };

    function tick(time: number) {
      lenisRef.current?.raf(time * 1000);
    }

    const setup = () => {
      if (query.matches) {
        setValue({ lenis: null, reducedMotion: true });
        return;
      }

      gsap.registerPlugin(ScrollTrigger);

      const lenis = new Lenis({
        // Native scroll: Lenis drives window.scrollTo, it does not transform a wrapper.
        wrapper: window,
        content: document.documentElement,
        autoRaf: false,
        duration: 1.05,
        smoothWheel: true,
        syncTouch: false,
        // A modal scrolls itself. Founder 2026-10-31: the make sheet stayed put while the page moved.
        prevent: (node) => node.closest('dialog, [role="dialog"]') !== null,
      });
      lenisRef.current = lenis;

      lenis.on('scroll', ScrollTrigger.update);

      ScrollTrigger.scrollerProxy(document.documentElement, {
        scrollTop(nextValue?: number) {
          if (typeof nextValue === 'number') {
            lenis.scrollTo(nextValue, { immediate: true });
            return nextValue;
          }
          return lenis.scroll;
        },
        getBoundingClientRect() {
          return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
        },
        // Native scroll ⇒ pinned elements use position: fixed, never a transform.
        pinType: 'fixed',
      });

      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      ScrollTrigger.refresh();

      setValue({ lenis, reducedMotion: false });
    };

    setup();

    const onPreferenceChange = () => {
      teardown();
      setup();
    };
    query.addEventListener('change', onPreferenceChange);

    return () => {
      query.removeEventListener('change', onPreferenceChange);
      teardown();
    };
  }, []);

  return <ScrollContext.Provider value={value}>{children}</ScrollContext.Provider>;
}
