import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { heroEvidence } from '@/lib/content/slots';

vi.mock('@/lib/flags', () => ({ RENDER_PIPELINE_PUBLIC: false, RENDER_PIPELINE_MODE: 'off' }));

import { CreatorHero } from '@/components/audience/creator-home';
import { HeroEvidence } from '@/components/audience/hero-evidence';

/**
 * "증거 먼저" (docs/PLATFORM-2.0.md §15.3-2): the home hero shows a selfie and the scene that face
 * went into, before any sign-in. The two pictures are a content slot the founder fills
 * (NEXT_PUBLIC_HERO_EVIDENCE_BEFORE / _AFTER) — and until BOTH are set, nothing renders and the hero
 * keeps its old shape, so production cannot show half a pair.
 */

const PAIR = { before: '/images/portrait-guide/front-facing.webp', after: '/reel/campaigns/highteen.jpg' };

describe('the hero evidence slot', () => {
  it('is a pair or nothing', () => {
    expect(heroEvidence({})).toBeNull();
    expect(heroEvidence({ NEXT_PUBLIC_HERO_EVIDENCE_BEFORE: PAIR.before })).toBeNull();
    expect(heroEvidence({ NEXT_PUBLIC_HERO_EVIDENCE_AFTER: PAIR.after })).toBeNull();
    expect(heroEvidence({ NEXT_PUBLIC_HERO_EVIDENCE_BEFORE: '  ', NEXT_PUBLIC_HERO_EVIDENCE_AFTER: PAIR.after })).toBeNull();
    expect(heroEvidence({ NEXT_PUBLIC_HERO_EVIDENCE_BEFORE: ` ${PAIR.before} `, NEXT_PUBLIC_HERO_EVIDENCE_AFTER: PAIR.after })).toEqual(PAIR);
  });
});

describe('the selfie → scene pair', () => {
  for (const locale of ['ko', 'en'] as const) {
    const dict = getDictionary(locale);
    const t = dict.creatorJourney;

    it(`renders nothing without a pair (${locale})`, () => {
      expect(renderToStaticMarkup(<HeroEvidence pair={null} copy={t} />)).toBe('');
    });

    it(`shows the selfie on the left, the scene on the right, then one line (${locale})`, () => {
      const html = renderToStaticMarkup(<HeroEvidence pair={PAIR} copy={t} />);
      expect(html).toContain('data-hero-evidence');
      const before = html.indexOf(`src="${PAIR.before}"`);
      const after = html.indexOf(`src="${PAIR.after}"`);
      expect(before).toBeGreaterThan(-1);
      expect(after).toBeGreaterThan(before);
      expect(html).toContain(`alt="${t.evidenceSelfieAlt}"`);
      expect(html).toContain(`alt="${t.evidenceSceneAlt}"`);
      expect(html).toContain(t.evidenceLine);
    });

    it(`keeps the old hero when the slot is empty, and puts the pair above the one CTA when it is not (${locale})`, () => {
      const without = renderToStaticMarkup(<CreatorHero locale={locale} dict={dict} evidence={null} />);
      expect(without).not.toContain('data-hero-evidence');
      expect(without.match(/data-hero-video/g)).toHaveLength(1);

      const withPair = renderToStaticMarkup(<CreatorHero locale={locale} dict={dict} evidence={PAIR} />);
      expect(withPair).toContain('data-hero-evidence');
      expect(withPair.match(/data-hero-video/g)).toHaveLength(1);
      expect(withPair.indexOf('data-hero-evidence')).toBeLessThan(withPair.indexOf('data-hero-video'));
    });
  }
});
