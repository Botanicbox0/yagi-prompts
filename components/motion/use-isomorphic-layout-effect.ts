'use client';

import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server (where React would warn).
 *
 * Every §5.3 scene arms its own hidden state in a LAYOUT effect rather than shipping it in the
 * HTML: the server render is always the readable, fully-visible, motion-free version, so no-JS,
 * reduced-motion and a broken GSAP all degrade to the same honest page.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
