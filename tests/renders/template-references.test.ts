import { describe, expect, it } from 'vitest';
import {
  BEAUTY_AD_TEMPLATE_ID,
  CITY_FASHION_MONTAGE_TEMPLATE_ID,
  fixedVideoReferenceUrls,
} from '@/lib/renders/template-references';

describe('fixed video template references', () => {
  it('puts the City Fashion logo after the customer identity image as Image 2', () => {
    expect(fixedVideoReferenceUrls(CITY_FASHION_MONTAGE_TEMPLATE_ID, 'https://twings.app')).toEqual([
      'https://twings.app/templates/city-fashion/yagi-yw-logo.png',
    ]);
  });

  it('keeps the existing beauty product contract and ignores unknown templates', () => {
    expect(fixedVideoReferenceUrls(BEAUTY_AD_TEMPLATE_ID, 'https://twings.app')).toEqual([
      'https://twings.app/templates/beauty-ad/yagi-lip-gloss.jpg',
    ]);
    expect(fixedVideoReferenceUrls('00000000-0000-4000-8000-000000000000', 'https://twings.app')).toEqual([]);
  });
});
