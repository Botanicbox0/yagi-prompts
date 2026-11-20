import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Sound studio slice SS1 (docs/BRAND-SOUND-STUDIO.md §7.3): the page's 404 table and gate order. The studio
 * route guard (sandbox, generation policy, project-only guest, BRAND_STUDIO_V2) has its own tests; here it is
 * a stub that either answers or 404s.
 */
const ROOT = process.cwd();
const ORG = '00000000-0000-4000-8000-0000000000ab';

const mocks = vi.hoisted(() => ({
  studioRouteContext: vi.fn(),
  loadSoundStudio: vi.fn(),
  assertBrandFeature: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/components/brand-workspace/context', () => ({ brandContext: vi.fn() }));
vi.mock('@/components/brand-workspace/scope', () => ({ brandScope: vi.fn() }));
vi.mock('@/components/brand-studio/route-context', () => ({ studioRouteContext: mocks.studioRouteContext }));
vi.mock('@/lib/brand-studio/sound/load', () => ({ loadSoundStudio: mocks.loadSoundStudio }));
vi.mock('@/components/brand-studio/sound/sound-studio', () => ({
  SoundStudio: function SoundStudioStub() {
    return null;
  },
}));
vi.mock('@/lib/brands/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brands/entitlements')>('@/lib/brands/entitlements');
  return { ...actual, assertBrandFeature: mocks.assertBrandFeature };
});

describe('/brand/studio/sound page gate', () => {
  const dict = getDictionary('ko');
  const choice = { id: ORG, name: 'Brand', role: 'owner', denied: [] as string[] };

  beforeEach(() => {
    mocks.studioRouteContext.mockReset();
    mocks.loadSoundStudio.mockReset();
    mocks.assertBrandFeature.mockReset();
    mocks.loadSoundStudio.mockResolvedValue({ tracks: [], jobs: [], allowance: { capKrw: 0, usedKrw: 0, resetsAt: '2026-12-01T00:00:00.000Z' } });
    mocks.assertBrandFeature.mockResolvedValue(undefined);
    mocks.studioRouteContext.mockResolvedValue({
      choice,
      access: { staff: false },
      locale: 'ko',
      dict,
      deps: { sql: {} },
      viewer: { userId: randomUUID() },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const loadPage = async () => (await import('@/app/(brand)/brand/studio/sound/page')).default;
  const call = async (tab?: string) => (await loadPage())({ searchParams: Promise.resolve({ organizationId: ORG, ...(tab ? { tab } : {}) }) });

  it('404s while the flag is off, before reading anything', async () => {
    for (const value of ['', 'off', 'ON']) {
      vi.stubEnv('BRAND_SOUND_STUDIO', value);
      await expect(call()).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.loadSoundStudio).not.toHaveBeenCalled();
  });

  it('404s when the studio guard does (sandboxed, generation closed, project-only guest), whatever the flag', async () => {
    vi.stubEnv('BRAND_SOUND_STUDIO', 'on');
    mocks.studioRouteContext.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
    await expect(call()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadSoundStudio).not.toHaveBeenCalled();
  });

  it('404s for a brand whose policy denies sound, from the choice or from the policy row', async () => {
    vi.stubEnv('BRAND_SOUND_STUDIO', 'on');
    mocks.studioRouteContext.mockResolvedValueOnce({ choice: { ...choice, denied: ['sound'] }, access: { staff: false }, locale: 'ko', dict, deps: { sql: {} }, viewer: { userId: null } });
    await expect(call()).rejects.toThrow('NEXT_NOT_FOUND');
    const { BrandFeatureDenied } = await vi.importActual<typeof import('@/lib/brands/entitlements')>('@/lib/brands/entitlements');
    mocks.assertBrandFeature.mockRejectedValueOnce(new BrandFeatureDenied('sound'));
    await expect(call()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadSoundStudio).not.toHaveBeenCalled();
  });

  it('renders the studio with its copy, the tab from the address, and scoped links', async () => {
    vi.stubEnv('BRAND_SOUND_STUDIO', 'on');
    const element = (await call('sfx')) as ReactElement<{ copy: unknown; initialTab: string; hrefs: Record<string, string>; canCreate: boolean }>;
    expect((element.type as { name?: string }).name).toBe('SoundStudioStub');
    expect(element.props.copy).toBe(dict.studioSound);
    expect(element.props.initialTab).toBe('sfx');
    expect(element.props.canCreate).toBe(true);
    for (const href of Object.values(element.props.hrefs)) expect(href).toContain(ORG);
    expect(mocks.assertBrandFeature).toHaveBeenCalledWith({}, ORG, 'sound');
  });

  it('runs the studio guard before its own flag and the sound policy', () => {
    const source = readFileSync(join(ROOT, 'app/(brand)/brand/studio/sound/page.tsx'), 'utf8');
    const body = source.slice(source.indexOf('export default'));
    const guard = body.indexOf('studioRouteContext(');
    const flag = body.indexOf('brandSoundStudioOpen()');
    const policy = body.indexOf("assertBrandFeature(deps.sql, choice.id, 'sound')");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(flag);
    expect(flag).toBeLessThan(policy);
  });
});

