/**
 * The campaigns page showreel (founder, 2026-09-14) — four studio-made formats that say what a
 * campaign scene looks like before a brand reads a word. Static files under `public/reel/campaigns`,
 * served by the project host: ~4 MB each at H.264 / CRF 24, a poster frame beside each, so the page
 * paints four stills and streams a clip only when it is on screen (see `components/campaigns/showreel.tsx`).
 *
 * Why the repo and not the public bucket: `publicContentUrl()` is `null` in local mode, and the
 * host's bandwidth allowance is the larger of the two. Replacing a clip is a file swap + a line here.
 *
 * The four are ordered for the 4-column grid: landscape (3 cols) + portrait, then portrait +
 * landscape — two rows, each a wide frame beside a tall one.
 */

export type ReelId = 'beauty' | 'retro1' | 'retro2' | 'highteen';

export interface ReelItem {
  id: ReelId;
  src: string;
  poster: string;
  orientation: 'landscape' | 'portrait';
  /** CSS `aspect-ratio` of the encoded file. */
  ratio: string;
}

export const REEL_BASE = '/reel/campaigns';

export const CAMPAIGN_REEL: readonly ReelItem[] = [
  { id: 'beauty', src: `${REEL_BASE}/beauty-rose.mp4`, poster: `${REEL_BASE}/beauty-rose.jpg`, orientation: 'landscape', ratio: '16 / 9' },
  { id: 'retro1', src: `${REEL_BASE}/retro-phone-01.mp4`, poster: `${REEL_BASE}/retro-phone-01.jpg`, orientation: 'portrait', ratio: '9 / 16' },
  { id: 'retro2', src: `${REEL_BASE}/retro-phone-02.mp4`, poster: `${REEL_BASE}/retro-phone-02.jpg`, orientation: 'portrait', ratio: '9 / 16' },
  { id: 'highteen', src: `${REEL_BASE}/highteen.mp4`, poster: `${REEL_BASE}/highteen.jpg`, orientation: 'landscape', ratio: '16 / 9' },
];
