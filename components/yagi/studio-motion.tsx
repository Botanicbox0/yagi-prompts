'use client';

import { useEffect } from 'react';
import { animate, inView } from 'motion';

/** Progressive enhancement: all content stays visible in the HTML, including without JavaScript. */
export function StudioMotion() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.querySelector('.yagi-site');
    if (!root) return;
    let release = () => {};
    function setup() {
      release();
      if (preference.matches || !root) return;
      const animations: Array<{ cancel: () => void }> = [];
      const stop = inView(Array.from(root.querySelectorAll('.yagi-section-head, .yagi-stage-bottom>p, .yagi-proof dl, .yagi-creator-copy, .yagi-contact h2')),
        element => {
          animations.push(animate(element, { opacity: [0, 1], y: [22, 0] }, { duration: .7, ease: [.22, 1, .36, 1] }));
        }, { amount: .2 });
      release = () => { stop(); animations.forEach(animation => animation.cancel()); };
    }
    setup();
    preference.addEventListener('change', setup);
    return () => { release(); preference.removeEventListener('change', setup); };
  }, []);
  return null;
}
