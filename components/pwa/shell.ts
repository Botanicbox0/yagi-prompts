/**
 * The installed app's shared constants (docs/PLATFORM-2.0.md §5.2). No directive on purpose: the
 * server layouts and the manifest read these values, and a `'use client'` module would hand them a
 * client reference instead of the string.
 */

/** YAGI v1.2 Dark Brand bg — the manifest colours, the standalone theme-color, `--color-app-bg`. */
export const APP_SHELL_BG = '#0A0A0A';

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
