import { describe, expect, it } from 'vitest';
import { isPublicCardLink, playbookHref } from '@/lib/content/links';
import { PLAYBOOK_DETAIL_ROUTE_READY } from '@/lib/flags';
import { formatCount, interpolate } from '@/lib/i18n/format';

describe('catalog card links (§3.1)', () => {
  const showcase = { slug: 'character-sheet-generation', isShowcase: true };
  const gated = { slug: 'talking-character-clip', isShowcase: false };

  it('sends non-showcase cards into the login wall — the intended funnel', () => {
    expect(playbookHref('en', gated)).toBe('/library');
    expect(playbookHref('ko', gated)).toBe('/library');
    expect(isPublicCardLink(gated)).toBe(false);
  });

  it('sends showcase cards straight to the public detail page now that M2 ships it', () => {
    // M2 flipped `PLAYBOOK_DETAIL_ROUTE_READY`; §3.1's split is live again — showcase playbooks are
    // the public SEO surface and go direct, everything else keeps funnelling through the wall.
    expect(PLAYBOOK_DETAIL_ROUTE_READY).toBe(true);
    expect(playbookHref('en', showcase)).toBe('/en/p/character-sheet-generation');
    expect(playbookHref('ko', showcase)).toBe('/ko/p/character-sheet-generation');
    expect(isPublicCardLink(showcase)).toBe(true);
  });
});

describe('copy interpolation (§3.9)', () => {
  it('substitutes named placeholders in either word order', () => {
    expect(
      interpolate('Currently {prompts} prompts across {playbooks} playbooks.', {
        prompts: 4,
        playbooks: 2,
      }),
    ).toBe('Currently 4 prompts across 2 playbooks.');

    expect(
      interpolate('지금 플레이북 {playbooks}개에 프롬프트 {prompts}개가 들어 있습니다.', {
        prompts: 4,
        playbooks: 2,
      }),
    ).toBe('지금 플레이북 2개에 프롬프트 4개가 들어 있습니다.');
  });

  it('leaves unknown placeholders alone rather than printing "undefined"', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('groups thousands per locale', () => {
    expect(formatCount(1240, 'en')).toBe('1,240');
    expect(formatCount(1240, 'ko')).toBe('1,240');
    expect(formatCount(7, 'ko')).toBe('7');
  });
});
