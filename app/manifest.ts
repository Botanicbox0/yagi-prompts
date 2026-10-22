import type { MetadataRoute } from 'next';
import { APP_SHELL_BG } from '@/components/pwa/shell';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * `/manifest.webmanifest` — docs/TEMPLATES-IA.md §5, the PWA's first step (founder decision
 * 2026-09-05: PWA first, Expo when the camera and push are needed), made into the app by
 * docs/PLATFORM-2.0.md §5.2 (2026-10-22: the store's in-app-payment cut does not fit the 5% margin,
 * so the installed web app IS the app).
 *
 * - Brand black (`#0A0A0A`, YAGI v1.2 Dark Brand) behind the splash and the status bar; the old
 *   white theme belonged to the browser tab, not to the app.
 * - `id` stays `/`, the value the first manifest shipped: a new id would make every installed copy
 *   a different app in the browser's eyes.
 * - `start_url` is the video formats, unprefixed: middleware 308s it to the reader's own
 *   `/{locale}/video?source=pwa`. A hard `/ko/video` would rewrite an English reader's locale
 *   cookie on every launch (a visited prefix is remembered as a choice — middleware.ts).
 * - Icons: `any` and `maskable` at 192 and 512, generated from app/icon.png by
 *   `npm run pwa:icons` (scripts/pwa-icons.mjs).
 *
 * The service worker (`public/sw.js`) answers navigations network first with an offline page, and
 * shows the completion push.
 *
 * One manifest, one language (audit P2-17): the install sheet shows a single description, and the
 * manifest already declares `lang: 'ko'` for the Korean-first audience, so the description and the
 * shortcut names are Korean from the dictionary — not English lines under a Korean `lang`.
 */

export default function manifest(): MetadataRoute.Manifest {
  const dict = getDictionary('ko');
  const shortcuts = dict.appShell.shortcuts;
  return {
    name: 'TWINGS',
    short_name: 'TWINGS',
    description: dict.meta.tagline,
    id: '/',
    start_url: '/video?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: APP_SHELL_BG,
    theme_color: APP_SHELL_BG,
    lang: 'ko',
    categories: ['photo', 'video', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: shortcuts.formats,
        short_name: shortcuts.formatsShort,
        url: '/video?source=pwa',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: shortcuts.renders,
        short_name: shortcuts.rendersShort,
        url: '/renders',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
