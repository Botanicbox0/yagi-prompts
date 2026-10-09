import { describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';

vi.mock('@/components/brand-workspace/context', () => ({ brandContext: async () => ({ sql: {}, viewer: {}, verifiedEmail: undefined, brandHost: true, b: getDictionary('en').brandWorkspace, locale: 'en' }) }));
vi.mock('@/lib/brands/workspace/service', () => ({ loadBrandProject: async () => ({ id: 'project', organizationId: 'org', role: 'viewer' }) }));
vi.mock('@/lib/brands/usage/service', () => ({ loadBrandUsage: async () => null }));
vi.mock('@/lib/brands/usage/runtime', () => ({ usagePaymentsOpen: () => false }));
import BrandProject from '@/app/(brand)/brand/projects/[id]/page';

describe('campaign detail list return context', () => {
  it('passes the validated list context through the server page', async () => {
    const page = await BrandProject({ params: Promise.resolve({ id: 'project' }), searchParams: Promise.resolve({ returnTo: '/brand?organizationId=org&q=launch&status=active#campaigns' }) });
    expect(page.props.backHref).toBe('/brand?organizationId=org&q=launch&status=active#campaigns');
  });
  it('uses the loaded project organization, never a supplied foreign or repeated return parameter', async () => {
    for (const returnTo of ['/brand?organizationId=other', '/admin/brand-workspace', 'https://evil.test/brand', ['/brand?organizationId=org']]) {
      const page = await BrandProject({ params: Promise.resolve({ id: 'project' }), searchParams: Promise.resolve({ returnTo }) });
      expect(page.props.backHref).toBe('/brand?organizationId=org');
    }
  });
});
