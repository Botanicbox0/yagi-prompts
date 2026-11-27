import { describe, expect, it } from 'vitest';
import { brandCampaignOpsOpenFor, videoPromptShieldOpenFor } from '@/lib/flags';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const OTHER = 'b0000000-0000-4000-8000-0000000000b2';

describe('brandCampaignOpsOpenFor switch', () => {
  it('stays closed when flag is unset, off, or wrong case, even with org list set', () => {
    expect(brandCampaignOpsOpenFor(ORG, {})).toBe(false);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'off' })).toBe(false);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'ON' })).toBe(false);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'true' })).toBe(false);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS_ORGS: ORG })).toBe(false);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'off', BRAND_CAMPAIGN_OPS_ORGS: '*' })).toBe(false);
  });

  it('opens for all orgs when org list is empty, whitespace, *, or all (case-insensitive)', () => {
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'on' })).toBe(true);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: ' , , ' })).toBe(true);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: '*' })).toBe(true);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: 'all' })).toBe(true);
    expect(brandCampaignOpsOpenFor(ORG, { BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: `${OTHER}, ALL ` })).toBe(true);
  });

  it('opens only for listed organization ids (trimmed, case-insensitive) and rejects missing ids', () => {
    const env = { BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: ` , ${ORG.toUpperCase()} , ` };
    expect(brandCampaignOpsOpenFor(ORG, env)).toBe(true);
    expect(brandCampaignOpsOpenFor(ORG.toUpperCase(), env)).toBe(true);
    expect(brandCampaignOpsOpenFor(OTHER, env)).toBe(false);
    expect(brandCampaignOpsOpenFor(null, { BRAND_CAMPAIGN_OPS: 'on' })).toBe(false);
    expect(brandCampaignOpsOpenFor(undefined, { BRAND_CAMPAIGN_OPS: 'on' })).toBe(false);
    expect(brandCampaignOpsOpenFor('   ', { BRAND_CAMPAIGN_OPS: 'on' })).toBe(false);
  });

  it('matches videoPromptShieldOpenFor switch parsing semantics', () => {
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'off', BRAND_CAMPAIGN_OPS: 'off' },
      { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on', BRAND_CAMPAIGN_OPS: 'on' },
      { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on', BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: ORG, BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: ORG },
      { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on', BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: OTHER, BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: OTHER },
    ];
    for (const env of cases) {
      expect(brandCampaignOpsOpenFor(ORG, env)).toBe(videoPromptShieldOpenFor(ORG, env));
    }
  });
});
