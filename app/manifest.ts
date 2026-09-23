import type { MetadataRoute } from 'next';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * `/manifest.webmanifest` — docs/TEMPLATES-IA.md §5, the PWA's first step (founder decision
 * 2026-09-05: PWA first, Expo when the camera and push are needed).
 *
 * Installable from the browser menu on Android and iOS; `start_url` is the root, which the locale
 * middleware 308s into the reader's language. The service worker (`public/sw.js`) is the minimal
 * one that makes the app installable everywhere and never serves stale HTML: every request goes to
 * the network first, and only the offline fallback is ever answered from cache.
 *
 * One manifest, one language (audit P2-17): the install sheet shows a single description, and the
 * manifest already declares `lang: 'ko'` for the Korean-first audience, so the description is the
 * Korean tagline from the dictionary — not an English line under a Korean `lang`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TWINGS',
    short_name: 'TWINGS',
    description: getDictionary('ko').meta.tagline,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'ko',
    categories: ['photo', 'video', 'entertainment'],
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
