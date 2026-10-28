import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { PromptDetailMedia } from '@/components/prompts/detail-media';
import { ResolutionPicker, TwingsStudio, type StudioLabels, type StudioLive, type StudioStyle } from '@/components/twings/studio';

/**
 * The studio as MARKUP — the first render, before any interaction. What it says to someone who
 * has not uploaded anything yet is the whole first impression, and it is static HTML.
 *
 * Founder, 2026-09-11: there is no demo any more. The static page every visitor gets is a neutral
 * skeleton (docs/PLATFORM-2.0.md §3.2-2); the access call then settles it — closed (payment opens
 * soon, leave your email), signed out (sign in to make it), or the make loop for a viewer it admits.
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
  closedTitle: dict.studio.closedTitle,
  closedBody: dict.studio.closedBody,
  closedCta: dict.studio.closedCta,
  closedDone: dict.studio.closedDone,
  runtimeLabel: dict.studio.runtimeLabel,
  needPhoto: dict.studio.needPhoto,
  noStyles: dict.studio.noStyles,
  moreTemplates: dict.studio.moreTemplates,
  aspectLabel: dict.studio.aspectLabel,
  pending: dict.studio.pending,
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

describe('the studio as every visitor first sees it — a neutral skeleton, never a guess', () => {
  const html = renderToStaticMarkup(<TwingsStudio styles={styles} labels={labels} initialStyleId="seoul-90s" live={live} />);

  // docs/PLATFORM-2.0.md §3.1: the static page used to paint "closed" and then flip once the access
  // call answered. Until it answers, the studio draws only where the photo and the button will be.
  it('draws photo and button placeholders, busy, with a spoken status', () => {
    expect(html).toContain('data-phase="pending"');
    expect(html).toContain('data-studio-pending');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(dict.studio.pending);
  });

  it('commits to nothing before the answer: not closed, not signed out, no pay button', () => {
    expect(html).not.toContain('data-studio-closed');
    expect(html).not.toContain('data-studio-signed-out');
    expect(html).not.toContain('data-pay-cta');
    expect(html).not.toContain('data-demo-badge');
    expect(html).not.toContain('progressbar');
  });

  it('still names the shape the page chose, so the sweep can find the one-style studio', () => {
    expect(html).toContain('data-single="true"');
  });
});

describe('the studio once the access call says the shop is closed', () => {
  const html = renderToStaticMarkup(<TwingsStudio styles={styles} labels={labels} initialStyleId="seoul-90s" live={live} initialAccess={{ open: false, live: false, signedIn: false }} />);

  it('says generation opens soon and offers the one thing it can: an email that day', () => {
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
});

describe('the studio for a signed-out reader while the shop is open', () => {
  const html = renderToStaticMarkup(<TwingsStudio styles={styles} labels={{ ...labels, signedOutBody: dict.studio.signedOutBody, signedOutCta: dict.studio.signedOutCta, photoExamples: dict.studio.photoExamples }} initialStyleId="seoul-90s" live={live} initialAccess={{ open: true, live: false, signedIn: false }} />);

  it('shows three photo examples, one line and one sign-in button — no black drop zone, no second title', () => {
    expect(html).toContain('data-phase="signed-out"');
    expect(html.match(/data-studio-photo-example=/g)).toHaveLength(3);
    for (const example of Object.values(dict.studio.photoExamples)) expect(html).toContain(example);
    expect(html).toContain('/images/portrait-guide/');
    expect(html).toContain(dict.studio.signedOutBody);
    expect(html.match(/data-studio-signin/g)).toHaveLength(1);
    expect(html).toContain(`href="${live.signinHref}"`);
    expect(html).not.toContain('data-selfie-uploader');
    expect(html).not.toContain('Put your face in this scene.');
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

describe('the resolution choice (docs/CREATOR-RESOLUTION.md)', () => {
  const options = [
    { id: '720p', price: '5,900원' },
    { id: '1080p', price: '11,900원' },
  ];
  for (const locale of ['ko', 'en'] as const) {
    it(`offers 720p as the pressed default and 1080p with its own price (${locale})`, () => {
      const d = getDictionary(locale).studio;
      const html = renderToStaticMarkup(
        <ResolutionPicker options={options} selected={null} onSelect={() => {}} labels={{ resolutionLabel: d.resolutionLabel, resolutionDefault: d.resolutionDefault, resolutionNote: d.resolutionNote }} />,
      );
      expect(html).toContain('data-resolution-picker');
      expect(html).toMatch(/data-resolution-option="720p" aria-pressed="true"/);
      expect(html).toMatch(/data-resolution-option="1080p" aria-pressed="false"/);
      expect(html).toContain(`720p · ${d.resolutionDefault}`);
      expect(html).toContain('11,900원');
      expect(html).toContain(d.resolutionLabel);
      expect(html).toContain(d.resolutionNote);
    });
  }

  it('marks an explicit 1080p choice as pressed', () => {
    const html = renderToStaticMarkup(<ResolutionPicker options={options} selected="1080p" onSelect={() => {}} labels={{}} />);
    expect(html).toMatch(/data-resolution-option="1080p" aria-pressed="true"/);
  });

  it('shows no choice for a template that sells only 720p, and none on the closed page', () => {
    expect(renderToStaticMarkup(<ResolutionPicker options={[options[0]!]} selected={null} onSelect={() => {}} labels={{}} />)).toBe('');
    const closed = renderToStaticMarkup(<TwingsStudio styles={[{ ...styles[0]!, resolutions: options }]} labels={labels} initialStyleId="seoul-90s" live={live} initialAccess={{ open: false, live: false, signedIn: false }} />);
    expect(closed).not.toContain('data-resolution-picker');
  });
});

describe('PromptDetailMedia hero video', () => {
  const controls = { play: '재생', pause: '일시정지', unmute: '소리 켜기', mute: '소리 끄기' };

  it('renders poster-first muted loop with preload=none, no native controls, and its own two controls', () => {
    const html = renderToStaticMarkup(
      <PromptDetailMedia
        poster={{ src: '/poster.jpg', mime: 'image/jpeg', w: 1280, h: 720 }}
        video={{ src: '/clip.mp4', mime: 'video/mp4', w: 1280, h: 720 }}
        alt="Result"
        aspect="16:9"
        controls={controls}
        fallback={null}
      />,
    );
    expect(html).toContain('preload="none"');
    expect(html).toContain('muted=""');
    expect(html).toContain('loop=""');
    expect(html).toContain('playsInline=""');
    expect(html).not.toContain('controls=');
    expect(html).toContain('data-detail-sound="muted"');
    expect(html).toContain('소리 켜기');
  });

  it('can always be paused or played (WCAG 2.2.2), labelled from the dictionary', () => {
    const html = renderToStaticMarkup(
      <PromptDetailMedia
        poster={{ src: '/poster.jpg', mime: 'image/jpeg' }}
        video={{ src: '/clip.mp4', mime: 'video/mp4' }}
        alt="Result"
        aspect="9:16"
        controls={{ play: 'Play', pause: 'Pause', unmute: 'Sound on', mute: 'Sound off' }}
        fallback={null}
      />,
    );
    // Nothing plays before the client arms it, so the server offers the play control.
    expect(html).toContain('data-detail-playback="paused"');
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('Sound on');
    expect(html).not.toMatch(/[가-힣]/);
  });

  it('shows the poster alone when there is no clip, with no controls', () => {
    const html = renderToStaticMarkup(
      <PromptDetailMedia poster={{ src: '/poster.jpg', mime: 'image/jpeg' }} video={null} alt="Result" aspect="16:9" controls={controls} fallback={null} />,
    );
    expect(html).toContain('/poster.jpg');
    expect(html).not.toContain('data-detail-playback');
    expect(html).not.toContain('data-detail-sound');
  });
});
