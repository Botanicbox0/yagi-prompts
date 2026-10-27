import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({ workspace: vi.fn(), access: vi.fn(), ready: true }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ tier: 'free', userId: 'f0000000-0000-4000-8000-000000000001', email: null, isAdmin: false, locale: 'ko' }) }));
// The workspace probes 0059 through this runner; answer "applied" or "not applied" per test.
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({ query: async () => ({ rows: [{ ready: mock.ready }] }) }) }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/creator-platform/runtime', () => ({ platformAccess: mock.access }));
vi.mock('@/lib/creator-platform/onboarding', () => ({ loadCreatorWorkspace: mock.workspace }));
vi.mock('@/components/app/app-header', () => ({ AppHeader: () => null }));
import CreatorWorkspacePage from '@/app/(app)/creators/workspace/page';
import { ko } from '@/messages/ko';
import type { CreatorWorkspace } from '@/lib/creator-platform/onboarding';

/** docs/PLATFORM-2.0.md §7.4: with 0059 the workspace's submission is a link to the recipe editor. */
const draftId = '11111111-1111-4111-8111-111111111111';
const data: CreatorWorkspace = {
  onboarding: true, application: null, creator: { active: true, contractVersion: 'pilot-v1', registeredAt: '2026-10-10T00:00:00.000Z' },
  formats: [{ id: draftId, title: 'DRAFT_RECIPE', medium: 'video', status: 'draft', exampleUrl: null, createdAt: '2026-10-22T00:00:00.000Z', reviewNote: null, reviewedAt: null, revisionOf: null, template: null }],
  earnings: [],
};
const render = async () => { mock.workspace.mockResolvedValue(data); return renderToString(await CreatorWorkspacePage({ searchParams: Promise.resolve({}) })); };
beforeEach(() => { mock.access.mockResolvedValue({ ready: true, community: false, creators: true, rewards: false, onboarding: true, applications: true }); });

describe('workspace → recipe editor', () => {
  it('links to the editor and lists a draft with "이어서 편집" once 0059 is applied', async () => {
    mock.ready = true;
    const html = await render();
    expect(html).toContain('data-recipe-new');
    expect(html).toContain('href="/creators/workspace/formats/new"');
    expect(html).not.toContain('data-creator-format-form');
    expect(html).toContain(ko.makerRecipe.draftState);
    expect(html).toContain(`href="/creators/workspace/formats/${draftId}"`);
  });
  it('keeps the older one-prompt form before 0059', async () => {
    mock.ready = false;
    const html = await render();
    expect(html).toContain('data-creator-format-form');
    expect(html).not.toContain('data-recipe-new');
  });
});
