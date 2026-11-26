import { describe, expect, it } from 'vitest';
import {
  INITIAL_DISMISS_STATE,
  buildNewsLineView,
  closeNewsLine,
  isNewsLineVisible,
  newsLineLinkAttrs,
  resolveNewsLineShape,
} from '@/components/brand-workspace/home/news-line/model';
import type { HomeAnnouncement } from '@/lib/brand-news/contracts';
import { BRAND_NEWS_LIMITS } from '@/lib/brand-news/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NEWS_A = '11111111-1111-4111-8111-111111111111';
const NEWS_B = '22222222-2222-4222-8222-222222222222';

const baseNews = (over: Partial<HomeAnnouncement> = {}): HomeAnnouncement => ({
  id: NEWS_A,
  kicker: null,
  title: '영상 스튜디오에서 참고 영상으로 바로 시작할 수 있습니다',
  ctaLabel: null,
  href: `/brand/studio/video?start=reverse&organizationId=${ORG}`,
  external: false,
  shape: 'line',
  image: null,
  ...over,
});

describe('resolveNewsLineShape', () => {
  it('returns line when shape is line', () => {
    expect(resolveNewsLineShape({ shape: 'line', image: null })).toBe('line');
  });

  it('returns banner when shape is banner and image is present', () => {
    expect(
      resolveNewsLineShape({
        shape: 'banner',
        image: { url: 'https://media.example.test/banner.webp', width: 1600, height: 400 },
      }),
    ).toBe('banner');
  });

  it('falls back to line when shape is banner but image is null', () => {
    expect(resolveNewsLineShape({ shape: 'banner', image: null })).toBe('line');
  });
});

describe('newsLineLinkAttrs', () => {
  it('keeps internal links as plain same-tab links without target or rel', () => {
    const attrs = newsLineLinkAttrs({ href: `/brand/studio/video?organizationId=${ORG}`, external: false });
    expect(attrs).toEqual({ href: `/brand/studio/video?organizationId=${ORG}` });
    expect('target' in attrs).toBe(false);
    expect('rel' in attrs).toBe(false);
  });

  it('keeps external twings.app links in the same tab without target or rel', () => {
    const attrs = newsLineLinkAttrs({ href: 'https://twings.app/ko/templates?from=brand', external: true });
    expect(attrs).toEqual({ href: 'https://twings.app/ko/templates?from=brand' });
    expect('target' in attrs).toBe(false);
    expect('rel' in attrs).toBe(false);
  });
});

describe('buildNewsLineView', () => {
  const ko = getDictionary('ko').brandNews;
  const en = getDictionary('en').brandNews;

  it('fills default kicker, button label, and accessible names when kicker and ctaLabel are null or empty', () => {
    const koView = buildNewsLineView(baseNews({ kicker: null, ctaLabel: null }), ko);
    expect(koView).toEqual({
      id: NEWS_A,
      shape: 'line',
      sectionLabel: '새 소식',
      kicker: '새 소식',
      title: '영상 스튜디오에서 참고 영상으로 바로 시작할 수 있습니다',
      ctaLabel: '자세히 보기',
      closeLabel: '닫기',
      link: { href: `/brand/studio/video?start=reverse&organizationId=${ORG}` },
      image: null,
    });

    const enView = buildNewsLineView(baseNews({ kicker: '', ctaLabel: '' }), en);
    expect(enView).toEqual({
      id: NEWS_A,
      shape: 'line',
      sectionLabel: "What's new",
      kicker: "What's new",
      title: '영상 스튜디오에서 참고 영상으로 바로 시작할 수 있습니다',
      ctaLabel: 'View more',
      closeLabel: 'Close',
      link: { href: `/brand/studio/video?start=reverse&organizationId=${ORG}` },
      image: null,
    });
  });

  it('uses provided kicker and ctaLabel while keeping sectionLabel as kickerDefault', () => {
    const longTitle = ('가나다라마바사아자차카타파하'.repeat(4) + '가나다라').slice(0, BRAND_NEWS_LIMITS.titleChars);
    expect(Array.from(longTitle)).toHaveLength(BRAND_NEWS_LIMITS.titleChars);

    const view = buildNewsLineView(
      baseNews({ kicker: '새 기능', title: longTitle, ctaLabel: '써 보기' }),
      ko,
    );
    expect(view.kicker).toBe('새 기능');
    expect(view.sectionLabel).toBe('새 소식');
    expect(view.ctaLabel).toBe('써 보기');
    expect(view.title).toBe(longTitle);
  });

  it('keeps image only when resolved shape is banner', () => {
    const banner = buildNewsLineView(
      baseNews({
        shape: 'banner',
        image: { url: 'https://media.example.test/b.webp', width: 1600, height: 400 },
      }),
      ko,
    );
    expect(banner.shape).toBe('banner');
    expect(banner.image).toEqual({ url: 'https://media.example.test/b.webp', width: 1600, height: 400 });

    const degraded = buildNewsLineView(baseNews({ shape: 'banner', image: null }), ko);
    expect(degraded.shape).toBe('line');
    expect(degraded.image).toBeNull();
  });
});

describe('close state transitions', () => {
  it('starts visible, hides immediately on first close with shouldSend=true, and prevents duplicate sends', () => {
    expect(isNewsLineVisible(INITIAL_DISMISS_STATE, NEWS_A)).toBe(true);

    const first = closeNewsLine(INITIAL_DISMISS_STATE, NEWS_A);
    expect(first.shouldSend).toBe(true);
    expect(first.next).toEqual({ dismissedId: NEWS_A });
    expect(isNewsLineVisible(first.next, NEWS_A)).toBe(false);

    // Second close on the same announcement does not re-send and preserves state reference
    const second = closeNewsLine(first.next, NEWS_A);
    expect(second.shouldSend).toBe(false);
    expect(second.next).toBe(first.next);

    // Another announcement id remains visible
    expect(isNewsLineVisible(first.next, NEWS_B)).toBe(true);
    const third = closeNewsLine(first.next, NEWS_B);
    expect(third.shouldSend).toBe(true);
    expect(third.next).toEqual({ dismissedId: NEWS_B });
  });
});
