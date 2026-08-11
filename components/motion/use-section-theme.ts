'use client';

import { useEffect, useState } from 'react';
import { pickSectionTheme, probeRootMargin, type SectionTheme } from '@/lib/motion/geometry';

/**
 * PLAN §4 — "theme is section-state-driven (IntersectionObserver flips `data-theme` — no
 * `mix-blend-mode` dependence)".
 *
 * The observer's root is shrunk to a 1px band at `probeY` (a *probe line*), so "which section am I
 * over right now" becomes a plain intersection question. Both overlay chrome elements use it: the
 * nav probes its own midpoint, the ad rail probes where its card sits.
 */
export function useSectionThemeAt(probeY: number, initial: SectionTheme = 'light'): SectionTheme {
  const [theme, setTheme] = useState<SectionTheme>(initial);

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-section][data-theme]'),
    );
    if (sections.length === 0) return;

    const order = new Map(sections.map((el, index) => [el, index] as const));
    const intersecting = new Set<HTMLElement>();
    let observer: IntersectionObserver | null = null;

    const attach = () => {
      observer?.disconnect();
      intersecting.clear();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            if (entry.isIntersecting) intersecting.add(el);
            else intersecting.delete(el);
          }
          setTheme(
            pickSectionTheme(
              [...intersecting].map((el) => ({ theme: el.dataset.theme, order: order.get(el) ?? 0 })),
              initial,
            ),
          );
        },
        { rootMargin: probeRootMargin(probeY, window.innerHeight), threshold: 0 },
      );
      sections.forEach((section) => observer!.observe(section));
    };

    attach();
    window.addEventListener('resize', attach);
    return () => {
      window.removeEventListener('resize', attach);
      observer?.disconnect();
    };
  }, [probeY, initial]);

  return theme;
}
