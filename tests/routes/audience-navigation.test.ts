import { describe, expect, it } from 'vitest';
import { audienceNavigation, audienceForPath } from '@/lib/navigation/audience';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { brandEnquiryHref, brandsHref } from '@/lib/campaigns/links';

describe('public audience navigation', () => {
  it('uses explicit public URLs without changing identity or roles', () => {
    for (const locale of ['ko', 'en'] as const) {
      const creator = audienceNavigation(locale, getDictionary(locale), '/t/chosen-template');
      expect(creator.audience).toBe('creator');
      expect(creator.modes.map(mode => mode.href)).toEqual([`/${locale}`, `/${locale}/brands`]);
      expect(creator.signInHref).toContain(encodeURIComponent(`/${locale}/t/chosen-template`));
      expect(creator.links.map(link => link.href)).toContain(`/${locale}/campaigns`);
      const brand = audienceNavigation(locale, getDictionary(locale), '/brands');
      expect(brand.audience).toBe('brand');
      expect(brand.primary.href).toBe(`/${locale}/brands#brands`);
      expect(brand.signInHref).toBe(`https://brand.twings.app/auth/choose?next=%2Fbrand&locale=${locale}`);
      expect(brand.links.some(link => /\/video|\/pricing/.test(link.href))).toBe(false);
    }
  });
  it('routes every enquiry entry to the visible brand form', () => {
    expect(brandsHref('ko')).toBe('/ko/brands');
    expect(brandEnquiryHref('en')).toBe('/en/brands#brands');
    expect(audienceForPath('/brands')).toBe('brand');
    for (const path of ['/brands/', '/brands?type=production', '/brands#work', '/brands/future']) expect(audienceForPath(path)).toBe('brand');
    expect(audienceForPath('/brands-lookalike')).toBe('creator');
    expect(audienceForPath('/campaigns')).toBe('creator');
  });
});
