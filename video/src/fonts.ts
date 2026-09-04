import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// Self-hosted WOFF2 copied from ../assets/fonts (same faces the site ships, PLAN §5.2).
// @remotion/fonts blocks the frame (delayRender) until each face is usable.
export const DISPLAY = 'Big Shoulders';
export const BODY = 'Satoshi';
export const MONO = 'Geist Mono';

export const fontsReady = Promise.all([
  loadFont({ family: DISPLAY, url: staticFile('fonts/big-shoulders-latin-900.woff2'), weight: '900' }),
  loadFont({ family: DISPLAY, url: staticFile('fonts/big-shoulders-latin-700.woff2'), weight: '700' }),
  loadFont({ family: BODY, url: staticFile('fonts/satoshi-500.woff2'), weight: '500' }),
  loadFont({ family: BODY, url: staticFile('fonts/satoshi-400.woff2'), weight: '400' }),
  loadFont({ family: MONO, url: staticFile('fonts/geist-mono-400.woff2'), weight: '400' }),
]);
