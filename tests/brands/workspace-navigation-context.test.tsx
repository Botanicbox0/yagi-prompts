import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { campaignFiltersFromUrl, campaignFilterHref } from '@/components/brand-workspace/campaign-list';
import { campaignListReturnPath } from '@/lib/brands/workspace/navigation';
import { ProjectTabs } from '@/components/brand-workspace/project-tabs';
import { getDictionary } from '@/lib/i18n/dictionaries';

describe('workspace navigation context', () => {
  it('restores campaign filters and rejects unsupported statuses', () => {
    expect(campaignFiltersFromUrl('?organizationId=org&q=Launch&status=active')).toEqual({ query: 'Launch', status: 'active' });
    expect(campaignFiltersFromUrl('?status=constructor')).toEqual({ query: '', status: 'all' });
  });
  it('changes only filters and preserves organization, other query parameters and hash', () => {
    const href = campaignFilterHref('https://brand.twings.app/brand?organizationId=org&source=mail&q=old#campaigns', { query: 'New launch', status: 'active' });
    const url = new URL(href, 'https://brand.twings.app');
    expect(url.searchParams.get('organizationId')).toBe('org');
    expect(url.searchParams.get('source')).toBe('mail');
    expect(url.searchParams.get('q')).toBe('New launch');
    expect(url.searchParams.get('status')).toBe('active');
    expect(url.hash).toBe('#campaigns');
    expect(campaignFilterHref(url.href, { query: '', status: 'all' })).toBe('/brand?organizationId=org&source=mail#campaigns');
  });
  it('shows review counts independently of total conversation messages', () => {
    const html = renderToStaticMarkup(<ProjectTabs b={getDictionary('en').brandWorkspace} pendingReviews={2} comments={9}><div /></ProjectTabs>);
    expect(html).toContain('data-review-count="2"');
    expect(html).toContain('data-comment-count="9"');
    expect(html).not.toMatch(/unread/i);
  });
});

describe('campaign list return boundary', () => {
  it('keeps filters, other list state and the fragment within the current brand', () => {
    expect(campaignListReturnPath('/brand?organizationId=org&q=Launch&status=active&source=mail#campaigns', 'org')).toBe('/brand?organizationId=org&q=Launch&status=active&source=mail#campaigns');
    expect(campaignListReturnPath('/brand?q=Launch', 'org')).toBe('/brand?q=Launch&organizationId=org');
  });
  it.each(['https://evil.test/brand', '//evil.test/brand', '/admin/brand-workspace', '/brand/projects/other', '/brand?organizationId=other', '/brand?organizationId=org&organizationId=other'])('refuses foreign or ambiguous return location %s', value => {
    expect(campaignListReturnPath(value, 'org')).toBe('/brand?organizationId=org');
  });
  it('accepts only the studio list in studio mode and rejects another organization', () => {
    expect(campaignListReturnPath('/admin/brand-workspace?q=Launch&status=active#queue', 'org', true)).toBe('/admin/brand-workspace?q=Launch&status=active#queue');
    expect(campaignListReturnPath('/brand?organizationId=org', 'org', true)).toBe('/admin/brand-workspace');
    expect(campaignListReturnPath('/admin/brand-workspace?organizationId=other', 'org', true)).toBe('/admin/brand-workspace');
    expect(campaignListReturnPath(['/brand'], 'org')).toBe('/brand?organizationId=org');
  });
});
