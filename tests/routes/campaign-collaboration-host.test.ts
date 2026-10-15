import { describe, it, expect } from 'vitest';
import { isCampaignAppPath } from '@/lib/i18n/config';
import { adminRouteAllowed, brandRouteAllowed } from '@/lib/routing/surfaces';

describe('campaign collaboration surface boundaries', () => {
  it('keeps join and participation leaves in the private application surface', () => {
    expect(isCampaignAppPath('/campaigns/example/join')).toBe(true);
    expect(isCampaignAppPath('/campaigns/participations/00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isCampaignAppPath('/campaigns/example')).toBe(false);
    expect(isCampaignAppPath('/campaigns/example/join/extra')).toBe(false);
    expect(isCampaignAppPath('/campaigns/participations/id/extra')).toBe(false);
  });
  it('opens only the brand collaboration POST and authenticated file reads', () => {
    expect(brandRouteAllowed('/api/campaign-collaboration','POST')).toBe(true);
    expect(brandRouteAllowed('/api/campaign-collaboration','GET')).toBe(false);
    for (const method of ['GET','HEAD']) expect(brandRouteAllowed('/api/campaign-collaboration/files/00000000-0000-4000-8000-000000000001',method)).toBe(true);
    expect(brandRouteAllowed('/api/campaign-collaboration/files/id','POST')).toBe(false);
    expect(brandRouteAllowed('/api/campaign-risk-worker/claim','POST')).toBe(false);
    expect(brandRouteAllowed('/api/campaign-collaboration/other','POST')).toBe(false);
  });
  it('keeps administrator writes behind admin/do', () => {
    expect(brandRouteAllowed('/api/campaign-funding', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/campaign-funding', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/campaign-funding', 'DELETE')).toBe(false);
    expect(brandRouteAllowed('/api/campaign-funding/unknown', 'POST')).toBe(false);
    expect(adminRouteAllowed('/api/campaign-funding', 'POST')).toBe(false);
    expect(adminRouteAllowed('/api/campaign-collaboration','POST')).toBe(false);
    expect(adminRouteAllowed('/api/campaign-collaboration/files/00000000-0000-4000-8000-000000000001','GET')).toBe(true);
    expect(adminRouteAllowed('/api/campaign-collaboration/files/id','DELETE')).toBe(false);
    expect(adminRouteAllowed('/api/campaign-risk-worker/claim','POST')).toBe(false);
  });
});
