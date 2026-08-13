import { describe, expect, it } from 'vitest';
import {
  localeAlternates,
  playbookMetadata,
  playbookPath,
  unresolvedPlaybookMetadata,
} from '@/lib/seo/playbook-metadata';
import { contestMetadata, contestsListingMetadata } from '@/lib/seo/contest-metadata';
import type { ShapedAssetRef } from '@/lib/content/shape';

/**
 * PLAN §3.9 + §8 M5 — "Verify hreflang/canonical emission on showcase details (M2 shipped it —
 * assert in tests). OG: showcase pages emit `og:image` from the public hero."
 *
 * M2 shipped this logic inside the page component, where nothing but a running server could see it.
 * M5 moved it into `lib/seo/playbook-metadata.ts` unchanged so these assertions can exist at all;
 * `npm run sweep:anon` then checks the same properties on real emitted HTML.
 */

const BASE = {
  slug: 'character-sheet-generation',
  title: { en: 'Character sheet generation', ko: '캐릭터 시트 제작' },
  summary: { en: 'One face, many poses.', ko: '한 얼굴, 여러 포즈.' },
  siteName: 'YAGI PROMPTS',
};

const PUBLIC_HERO: ShapedAssetRef = {
  source: 'public',
  src: 'https://cdn.test/storage/v1/object/public/public-content/abc.png',
  mime: 'image/png',
};

const GATEWAY_HERO: ShapedAssetRef = {
  source: 'gateway',
  src: '/api/media/rev-1%3Ahero',
  mime: 'image/png',
};

describe('playbook metadata (§3.9)', () => {
  it('emits a self-canonical plus reciprocal hreflang on a showcase page', () => {
    for (const locale of ['en', 'ko'] as const) {
      const meta = playbookMetadata({ ...BASE, locale, is_showcase: true, hero: PUBLIC_HERO });
      expect(meta.alternates?.canonical, locale).toBe(playbookPath(locale, BASE.slug));
      expect(meta.alternates?.languages, locale).toEqual({
        en: '/en/p/character-sheet-generation',
        ko: '/ko/p/character-sheet-generation',
        'x-default': '/en/p/character-sheet-generation',
      });
      expect(meta.robots).toBeUndefined();
    }
  });

  it('localizes the title and description from the same fields the page renders', () => {
    expect(playbookMetadata({ ...BASE, locale: 'ko', is_showcase: true, hero: null }).title).toBe(
      '캐릭터 시트 제작',
    );
    expect(
      playbookMetadata({ ...BASE, locale: 'en', is_showcase: true, hero: null }).description,
    ).toBe('One face, many poses.');
  });

  it('takes og:image from a PUBLIC hero only — a crawler has no session', () => {
    const withPublic = playbookMetadata({
      ...BASE,
      locale: 'en',
      is_showcase: true,
      hero: PUBLIC_HERO,
    });
    expect(withPublic.openGraph).toMatchObject({
      type: 'article',
      locale: 'en_US',
      images: [{ url: PUBLIC_HERO.src }],
    });

    // A gateway path would answer 401 to an anonymous crawler and render a broken card.
    const withGateway = playbookMetadata({
      ...BASE,
      locale: 'ko',
      is_showcase: true,
      hero: GATEWAY_HERO,
    });
    expect(withGateway.openGraph).toBeDefined();
    expect('images' in (withGateway.openGraph ?? {})).toBe(false);
    expect(withGateway.openGraph).toMatchObject({ locale: 'ko_KR' });
  });

  it('deindexes a non-showcase playbook and advertises nothing about it', () => {
    const meta = playbookMetadata({ ...BASE, locale: 'en', is_showcase: false, hero: PUBLIC_HERO });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
    // The title is still correct — it is the browser tab of a page a signed-in reader may open.
    expect(meta.title).toBe('Character sheet generation');
  });

  it('deindexes draft / archived / unknown', () => {
    expect(unresolvedPlaybookMetadata('YAGI PROMPTS')).toEqual({
      title: 'YAGI PROMPTS',
      robots: { index: false, follow: false },
    });
  });

  it('builds alternates for any locale-prefixed path, root included', () => {
    expect(localeAlternates('/')).toEqual({ en: '/en', ko: '/ko', 'x-default': '/en' });
    expect(localeAlternates('/pricing')).toEqual({
      en: '/en/pricing',
      ko: '/ko/pricing',
      'x-default': '/en/pricing',
    });
  });
});

/** F6 — og:site_name on the contests surface (the prompts twin lives in prompt-seo.test.ts). */
describe('contest metadata og:site_name (F6)', () => {
  it('names the site on the detail and listing OG objects', () => {
    const detail = contestMetadata({
      contest: {
        slug: 'launch-film-contest',
        title: { en: 'Launch film contest', ko: '런칭 필름 콘테스트' },
        summary: { en: 'Bring the brief to life.', ko: '브리프를 영상으로.' },
        poster: null,
        video: null,
      },
      locale: 'en',
      siteName: 'YAGI PROMPTS',
    });
    expect((detail.openGraph as { siteName?: string }).siteName).toBe('YAGI PROMPTS');

    const listing = contestsListingMetadata({
      locale: 'ko',
      title: 'Contests',
      description: 'D',
      siteName: 'YAGI PROMPTS',
    });
    expect((listing.openGraph as { siteName?: string }).siteName).toBe('YAGI PROMPTS');
  });
});
