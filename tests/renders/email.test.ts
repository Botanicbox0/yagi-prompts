import { describe, expect, it } from 'vitest';
import { renderResultEmail } from '@/lib/renders/email';

const LINKS = {
  primaryUrl: 'https://twings.app/r/11111111-1111-4111-8111-111111111111/tok',
  previewUrl: 'https://twings.app/api/renders/media/11111111-1111-4111-8111-111111111111?s=tok',
  templateUrl: 'https://twings.app/ko/t/static-portrait-window-light',
  rendersUrl: 'https://twings.app/renders',
  feedbackUrl: 'https://twings.app/renders/r1#feedback',
};

describe('the completion email', () => {
  it('carries the link, the preview and the expiry — and nothing about how the render was made', () => {
    const email = renderResultEmail({
      kind: 'ready',
      locale: 'ko',
      templateTitle: '정적 인물, 창문 광',
      medium: 'image',
      aspect: '4:5',
      expiresAt: new Date('2026-09-09T12:00:00.000Z'),
      reason: null,
      links: LINKS,
      siteName: 'TWINGS',
    });
    expect(email.subject).toBe('완성됐어요 — 정적 인물, 창문 광');
    expect(email.html).toContain(LINKS.primaryUrl);
    expect(email.html).toContain(`<img src="${LINKS.previewUrl}"`);
    expect(email.html).toContain('결과 보기');
    expect(email.html).toContain('2026년 9월 9일');
    expect(email.html).toContain(LINKS.rendersUrl);
    expect(email.html).toContain('야기워크숍 주식회사');
    // The shared layout: one blue pill button, a white card on canvas — and no script, no prompt.
    expect(email.html).toContain('border-radius:999px');
    expect(email.html).not.toContain('<script');
    expect(email.html).not.toContain('prompt');
    expect(email.text).toContain(LINKS.primaryUrl);
    expect(email.text).toContain('정적 인물, 창문 광');
  });

  it('shows a set: the first picture large, the others in one row, all opening the same link', () => {
    const more = [2, 3, 4, 5].map((n) => `${LINKS.previewUrl}&frame=${n}`);
    const email = renderResultEmail({
      kind: 'ready', locale: 'ko', templateTitle: '웨딩 화보 5컷', medium: 'image', aspect: '3:4',
      expiresAt: new Date('2026-10-31T12:00:00.000Z'), reason: null, frames: 5,
      links: { ...LINKS, morePreviewUrls: more }, siteName: 'TWINGS',
    });
    expect(email.html).toContain(`<img src="${LINKS.previewUrl}"`);
    const positions = more.map((url) => email.html.indexOf(`<img src="${url.replace(/&/g, '&amp;')}"`));
    expect(positions.every((i) => i > email.html.indexOf(`<img src="${LINKS.previewUrl}"`))).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(email.html).toContain('width="118"');
    expect(email.html).toContain('웨딩 화보 5컷 · 사진 5장 · 3:4');
    expect(email.text).toContain('사진 5장');
    // One result: no row.
    const single = renderResultEmail({ kind: 'ready', locale: 'ko', templateTitle: 'T', medium: 'image', aspect: '4:5', expiresAt: null, reason: null, links: LINKS, siteName: 'TWINGS' });
    expect(single.html).not.toContain('width="118"');
    expect(single.html).toContain('T · 이미지 · 4:5');
  });

  it('explains a failure in the reader’s language and points back at the template', () => {
    const email = renderResultEmail({
      kind: 'failed',
      locale: 'en',
      templateTitle: 'Static portrait, window light',
      medium: 'image',
      aspect: '4:5',
      expiresAt: null,
      reason: 'The prompt or the photo tripped the content policy.',
      links: { ...LINKS, previewUrl: null },
      siteName: 'TWINGS',
    });
    expect(email.subject).toBe('Not finished — Static portrait, window light');
    expect(email.html).toContain('tripped the content policy');
    expect(email.html).toContain(`href="${LINKS.templateUrl}"`);
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('Try again');
    // Payment outcome is supplied by the settlement service after provider confirmation.
    expect(email.text).not.toContain('not charged');
  });

  it('escapes a title that carries markup', () => {
    const email = renderResultEmail({
      kind: 'ready',
      locale: 'en',
      templateTitle: 'A <b>bold</b> & "quoted" title',
      medium: 'video',
      aspect: '9:16',
      expiresAt: new Date('2026-09-09T12:00:00.000Z'),
      reason: null,
      links: { ...LINKS, previewUrl: null },
      siteName: 'TWINGS',
    });
    expect(email.html).not.toContain('<b>bold</b>');
    expect(email.html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
  });
});
