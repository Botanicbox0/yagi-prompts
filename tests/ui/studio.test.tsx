import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { TwingsStudio, type StudioLabels, type StudioLive, type StudioStyle } from '@/components/twings/studio';

/**
 * The studio as MARKUP — the first render, before any interaction. What it says to someone who
 * has not uploaded anything yet is the whole first impression, and it is static HTML.
 *
 * Founder, 2026-09-11: there is no demo any more. The page every visitor gets is CLOSED — payment
 * opens soon, leave your email — and only a viewer the access call admits sees the make loop.
 */

const dict = getDictionary('en');
const labels: StudioLabels = {
  stepPhoto: dict.studio.stepPhoto,
  stepStyle: dict.studio.stepStyle,
  stepPay: dict.studio.stepPay,
  stepResult: dict.studio.stepResult,
  dropZone: dict.studio.dropZone,
  dropHint: dict.studio.dropHint,
  changePhoto: dict.studio.changePhoto,
  chooseStyle: dict.studio.chooseStyle,
  payCta: dict.studio.payCta,
  payNote: dict.studio.payNote,
  closedBadge: dict.studio.closedBadge,
  closedTitle: dict.studio.closedTitle,
  closedBody: dict.studio.closedBody,
  closedCta: dict.studio.closedCta,
  closedDone: dict.studio.closedDone,
  runtimeLabel: dict.studio.runtimeLabel,
  needPhoto: dict.studio.needPhoto,
  noStyles: dict.studio.noStyles,
  moreTemplates: dict.studio.moreTemplates,
  aspectLabel: dict.studio.aspectLabel,
};

const live: StudioLive = {
  endpoint: '/api/renders',
  accessEndpoint: '/api/renders/access',
  interestEndpoint: '/api/notify/interest',
  template: 'seoul-90s',
  locale: 'en',
  signinHref: '/auth/signin?next=%2Fen%2Ft%2Fseoul-90s',
  identityHref: '/identity/verify',
  labels: {
    badge: dict.renders.studio.badge,
    operatorBadge: dict.renders.studio.operatorBadge,
    freeCta: dict.renders.studio.freeCta,
    submitting: dict.renders.studio.submitting,
    identityNotice: dict.renders.studio.identityNotice,
    identityPending: dict.renders.studio.identityPending,
    identityCta: dict.renders.studio.identityCta,
    errors: dict.renders.studio.errors,
  },
};

const styles: StudioStyle[] = [
  {
    id: 'seoul-90s',
    title: '90s Seoul Interview',
    price: '$4',
    runtime: '15',
    blurb: '1994 Seoul, shot on Betacam',
    posterSrc: '/p.jpg',
    videoSrc: '/v.mp4',
    moreHref: '/en/video',
    aspects: [
      { id: '9:16', label: '9:16 · Reels & stories' },
      { id: '16:9', label: '16:9 · Landscape' },
    ],
    defaultAspect: '9:16',
  },
];

describe('the studio as every visitor first sees it — closed, never mocked', () => {
  const html = renderToStaticMarkup(<TwingsStudio styles={styles} labels={labels} initialStyleId="seoul-90s" live={live} />);

  it('says payment opens soon and offers the one thing it can: an email that day', () => {
    expect(html).toContain('data-phase="closed"');
    expect(html).toContain('data-studio-closed');
    expect(html).toContain(dict.studio.closedTitle);
    expect(html).toContain(dict.studio.closedBody);
    expect(html).toMatch(/data-studio-interest="open"/);
    expect(html).toContain(dict.studio.closedCta);
  });

  it('carries no demo, no fake progress and no sleeping pay button', () => {
    expect(html).not.toContain('data-demo-badge');
    expect(html).not.toContain('data-pay-cta');
    expect(html).not.toContain('progressbar');
    expect(html).not.toContain('Demo');
  });

  it('still names the shape the page chose, so the sweep can find the one-style studio', () => {
    expect(html).toContain('data-single="true"');
  });
});

describe('the studio without a live loop at all (the catalogue shape)', () => {
  it('is closed too — there is no third mode', () => {
    const html = renderToStaticMarkup(<TwingsStudio styles={styles} labels={labels} />);
    expect(html).toContain('data-phase="closed"');
    // No endpoint to post to: the button exists for the copy, but cannot promise anything.
    expect(html).toMatch(/data-studio-interest="open"[^>]*disabled=""/);
  });
});

describe('the studio with no scene to sell', () => {
  it('closes politely instead of rendering an empty grid and a dead button', () => {
    const html = renderToStaticMarkup(<TwingsStudio styles={[]} labels={labels} />);
    expect(html).toContain('data-phase="empty"');
    expect(html).toContain(dict.studio.noStyles);
    expect(html).not.toContain('data-pay-cta');
    expect(html).not.toContain('data-style-option');
  });
});
