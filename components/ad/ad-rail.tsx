'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScroll } from '@/components/motion/scroll-provider';
import { useSectionThemeAt } from '@/components/motion/use-section-theme';
import {
  BREAKPOINTS,
  isSettled,
  lerp,
  RAIL_LERP,
  RAIL_TOP_OFFSET,
  railTargetY,
} from '@/lib/motion/geometry';

/**
 * PLAN §3.6 / §5.3-7 — the lagged-follow ad rail.
 *
 *   · ≥1440 only. Below that the inline `<AdBanner>` is the ad, and this renders nothing —
 *     "never more than one ad per viewport".
 *   · A ROOT-LEVEL PORTAL with `position: fixed`, "never inside transformed/pinned ancestors":
 *     the pinned "How it reads" panels sit between the rail's start and end, and a fixed element
 *     inside a pinned (translated) ancestor would be dragged along by the pin.
 *   · The follow is a spring: each frame the transform chases `railTargetY()` at a 0.08 lerp, so
 *     the card trails the scroll and then settles. The loop stops the moment it has settled — an
 *     always-on rAF would show up as main-thread work for no motion.
 *   · `prefers-reduced-motion` ⇒ plain `position: sticky`, no portal, no rAF, no lag.
 *
 * The rail carries its own `data-theme`, resolved at the height it actually sits at, so it inverts
 * with the section behind it exactly like the nav does.
 */

type Mode = 'hidden' | 'follow' | 'sticky';

/**
 * The rail's horizontal position is BAND MATH, and the two bands differ (§4):
 *   landing / library  [1000 | 40 | 300] = 1340 → the CSS default in `.ad-rail-fixed`
 *   playbook detail    [220 | 40 | 720 | 40 | 300] = 1320 → this override
 * Passed in rather than sniffed, so the number in the component is the number in the plan.
 */
export const DETAIL_RAIL_LEFT =
  'calc(50% + (var(--container-stepindex) + var(--spacing-rail-gap) + var(--container-detail) + var(--spacing-rail-gap) - var(--container-rail)) / 2)';

export function AdRail({
  anchorId,
  left,
  children,
}: {
  anchorId: string;
  /** CSS `left` for the rail column. Defaults to the landing/library 1340 band. */
  left?: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>('hidden');
  const railRef = useRef<HTMLDivElement>(null);
  const { lenis } = useScroll();
  const theme = useSectionThemeAt(RAIL_TOP_OFFSET + 60);

  // --- which variant applies at this viewport / preference -----------------
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${BREAKPOINTS.rail}px)`);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const decide = () => setMode(!wide.matches ? 'hidden' : calm.matches ? 'sticky' : 'follow');
    decide();
    wide.addEventListener('change', decide);
    calm.addEventListener('change', decide);
    // Belt and braces: a `change` event can be missed during a fast drag-resize, and the tier
    // boundary is the difference between one ad on screen and two.
    window.addEventListener('resize', decide);
    return () => {
      wide.removeEventListener('change', decide);
      calm.removeEventListener('change', decide);
      window.removeEventListener('resize', decide);
    };
  }, []);

  // --- the spring ----------------------------------------------------------
  useEffect(() => {
    if (mode !== 'follow') return;
    const rail = railRef.current;
    const anchor = document.getElementById(anchorId);
    if (!rail || !anchor) return;

    let current = 0;
    let frame = 0;
    let primed = false;

    const step = () => {
      frame = 0;
      const anchorRect = anchor.getBoundingClientRect();
      const target = railTargetY({
        anchorTop: anchorRect.top,
        anchorBottom: anchorRect.bottom,
        railHeight: rail.offsetHeight,
        topOffset: RAIL_TOP_OFFSET,
      });

      if (!primed) {
        // First paint must not animate in from y=0 across half the page.
        current = target;
        primed = true;
      } else {
        current = lerp(current, target, RAIL_LERP);
      }

      rail.style.transform = `translate3d(0, ${current.toFixed(2)}px, 0)`;
      rail.style.visibility = 'visible';

      if (!isSettled(current, target)) frame = requestAnimationFrame(step);
    };

    const kick = () => {
      if (frame === 0) frame = requestAnimationFrame(step);
    };

    step();
    // §3.6: "off the Lenis scroll value". Native scroll is the fallback when Lenis is not running.
    lenis?.on('scroll', kick);
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      lenis?.off('scroll', kick);
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', kick);
    };
  }, [mode, anchorId, lenis]);

  if (mode === 'hidden') return null;

  if (mode === 'sticky') {
    return (
      <div
        data-theme={theme}
        /* `z-30` is load-bearing: this column is the FIRST child of the anchor, and every section
           after it is `position: relative` with `z-index: auto`, so without a stacking order the
           opaque sections paint straight over it. The fixed variant escapes this by living in a
           root-level portal; the sticky one has to ask. */
        className="pointer-events-none absolute top-0 z-30 hidden h-full rail:block"
        style={{
          left:
            left ??
            'calc(50% + (var(--container-content) - var(--container-rail)) / 2 + var(--spacing-rail-gap) / 2)',
          width: 'var(--container-rail)',
        }}
      >
        <div className="ad-rail-sticky pointer-events-auto">{children}</div>
      </div>
    );
  }

  return createPortal(
    <div
      ref={railRef}
      data-theme={theme}
      className="ad-rail-fixed invisible"
      {...(left ? { style: { left } } : {})}
    >
      {children}
    </div>,
    document.body,
  );
}
