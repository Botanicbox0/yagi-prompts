import { describe, expect, it } from 'vitest';
import { brandSoundComposerV2For } from '@/lib/flags';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const ORG_C = '00000000-0000-4000-8000-0000000000cc';

describe('brandSoundComposerV2For (BRAND_SOUND_COMPOSER_V2_ORGS)', () => {
  it('is closed when unset, empty, or whitespace/commas only', () => {
    expect(brandSoundComposerV2For(ORG_A, {})).toBe(false);
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: undefined })).toBe(false);
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: '' })).toBe(false);
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: '   \t\r\n  ' })).toBe(false);
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: ' , \n , \t ' })).toBe(false);
  });

  it('treats "*" and "all" as ordinary tokens, never wildcards for real organization ids', () => {
    for (const raw of ['*', ' * ', 'all', 'ALL', 'All', '*, all', `${ORG_B}, *, ALL`]) {
      expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: raw }), raw).toBe(false);
    }
  });

  it('is closed when only another organization is listed', () => {
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: ORG_B })).toBe(false);
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: `${ORG_B}, ${ORG_C}` })).toBe(false);
  });

  it('is open when the organization is listed', () => {
    expect(brandSoundComposerV2For(ORG_A, { BRAND_SOUND_COMPOSER_V2_ORGS: ORG_A })).toBe(true);
  });

  it('matches case-insensitively with surrounding spaces and newlines on either side', () => {
    const envMixed = { BRAND_SOUND_COMPOSER_V2_ORGS: `  \n\t ${ORG_A.toUpperCase()} \r\n ` };
    expect(brandSoundComposerV2For(ORG_A, envMixed)).toBe(true);
    expect(brandSoundComposerV2For(`  \n ${ORG_A.toUpperCase()} \t `, { BRAND_SOUND_COMPOSER_V2_ORGS: ORG_A })).toBe(true);
  });

  it('is closed for blank, null, or undefined orgId even with a non-empty list', () => {
    const env = { BRAND_SOUND_COMPOSER_V2_ORGS: `${ORG_A}, ${ORG_B}, *, all` };
    expect(brandSoundComposerV2For(undefined, env)).toBe(false);
    expect(brandSoundComposerV2For(null, env)).toBe(false);
    expect(brandSoundComposerV2For('', env)).toBe(false);
    expect(brandSoundComposerV2For('   \t\n  ', env)).toBe(false);
  });

  it('opens both organizations when two ids are separated by commas and/or whitespace', () => {
    for (const sep of [',', ', ', ' ', '\n', ',\n\t  ']) {
      const env = { BRAND_SOUND_COMPOSER_V2_ORGS: `${ORG_A}${sep}${ORG_B.toUpperCase()}` };
      expect(brandSoundComposerV2For(ORG_A, env), JSON.stringify(sep)).toBe(true);
      expect(brandSoundComposerV2For(ORG_B, env), JSON.stringify(sep)).toBe(true);
      expect(brandSoundComposerV2For(ORG_C, env), JSON.stringify(sep)).toBe(false);
    }
  });
});
