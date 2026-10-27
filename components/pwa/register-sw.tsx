'use client';

import { useEffect } from 'react';
import { captureInstallPrompt } from './install-prompt';

/**
 * Registers `public/sw.js` once the page is idle (docs/TEMPLATES-IA.md §5). Production only: a
 * worker in `next dev` would sit between HMR and the browser for no reason. Failures are silent —
 * an install prompt is a bonus, never a dependency.
 *
 * Mounted on every consumer page, so it is also where Chrome's install prompt is caught and held
 * for the install card (docs/PLATFORM-2.0.md §5.2, components/pwa/install-prompt.ts).
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (['admin.twings.app', 'brands.twings.app'].includes(window.location.hostname)) return;
    captureInstallPrompt();
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* installability is a bonus, never a dependency */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
