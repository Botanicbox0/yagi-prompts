/**
 * The installed app's shared constants (docs/PLATFORM-2.0.md §5.2). No directive on purpose: server
 * code may read these values too, and a `'use client'` module would hand it a client reference
 * instead of the string.
 */

/**
 * QA only: `localStorage['twings:display-mode'] = 'standalone'` makes a browser tab behave like the
 * installed app (bottom tabs, safe areas), so the shell can be checked without installing it.
 * Documented in docs/qa/app-shell/README.md. Nothing in the product writes it.
 */
export const DISPLAY_MODE_OVERRIDE_KEY = 'twings:display-mode';

/** "다시 보지 않기" on the install card — this browser only, by design. */
export const INSTALL_CARD_DISMISSED_KEY = 'twings:install-card';

/** Fired on `window` when this browser has just turned the completion push on (the card steps aside). */
export const PUSH_ON_EVENT = 'twings:push-on';
