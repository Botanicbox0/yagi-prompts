/**
 * Brand-format studies chosen for the public brand landing (founder, 2026-10-08).
 * These are studio examples, never presented as Morphic campaign evidence. Every file is silent,
 * fast-start H.264 with a separate poster so the page can stay poster-first on slow connections.
 */

export type ReelId = 'city' | 'y2k' | 'tea';

export interface ReelItem {
  id: ReelId;
  src: string;
  poster: string;
  orientation: 'landscape' | 'portrait';
  /** CSS `aspect-ratio` of the encoded file. */
  ratio: string;
  width: number;
  height: number;
}

export const REEL_BASE = '/reel/brands';

export const CAMPAIGN_REEL: readonly ReelItem[] = [
  { id: 'city', src: `${REEL_BASE}/city-fashion.mp4`, poster: `${REEL_BASE}/city-fashion.jpg`, orientation: 'landscape', ratio: '4 / 3', width: 1280, height: 960 },
  { id: 'y2k', src: `${REEL_BASE}/y2k-flip-phone.mp4`, poster: `${REEL_BASE}/y2k-flip-phone.jpg`, orientation: 'portrait', ratio: '9 / 16', width: 720, height: 1280 },
  { id: 'tea', src: `${REEL_BASE}/tea-editorial.mp4`, poster: `${REEL_BASE}/tea-editorial.jpg`, orientation: 'landscape', ratio: '4 / 3', width: 1112, height: 834 },
];
