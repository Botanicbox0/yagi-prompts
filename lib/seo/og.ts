/**
 * The share card (founder pass, 2026-08-13).
 *
 * The founder hands out twings.app (yagiprompts.com until 2026-09-02) as the profile link — the
 * audit that added this found
 * every page shipping og:title/og:description but NO og:image, which renders as a bare text row
 * in KakaoTalk, an Instagram DM or a Notion bookmark. One designed 1200×630 card fixes the whole
 * class: §5 language (Big Shoulders 900 on white, hairline frame, the accent as one blue period),
 * static PNG in the public folder so a crawler needs no session and no runtime.
 *
 * Source composition: `content/og/card-comp.html` (+ `gf-local.css` for the local woff2 faces) —
 * re-render at 1200×630 with headless Chrome (`--allow-file-access-from-files`) whenever the line
 * or the brand changes. Last render: TWINGS wordmark + twings.app, 2026-09-02.
 *
 * Detail pages that OWN an image (a prompt poster, a contest poster) keep it — a real frame beats
 * the brand card — and fall back here when media is absent.
 */

export const SITE_OG_IMAGE = {
  url: '/og/card.png',
  width: 1200,
  height: 630,
  alt: "TWINGS — one photo, one film, you're in it.",
};

/** Audit P2-17: the card's alt text in the page's language (Korean pages carried the English line). */
export function siteOgImage(locale: string): typeof SITE_OG_IMAGE & { alt: string } {
  return { ...SITE_OG_IMAGE, alt: locale === 'ko' ? 'TWINGS — 내 얼굴로 트렌드 포맷의 주인공이 되는 곳' : SITE_OG_IMAGE.alt };
}

/** `summary_large_image` is what turns the card from a text row into the full-width preview. */
export const SITE_TWITTER_CARD = 'summary_large_image' as const;
