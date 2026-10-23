import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), access: vi.fn(), save: vi.fn(), load: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mock.sql }));
vi.mock('@/lib/creator-platform/runtime', () => ({ platformAccess: mock.access }));
vi.mock('@/lib/cache', () => ({ revalidateMakerProfile: mock.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }); } }));
vi.mock('@/lib/makers/profile', async (original) => ({
  ...(await original<typeof import('@/lib/makers/profile')>()),
  saveMakerProfile: mock.save,
  loadMakerSettings: mock.load,
}));
import { saveMakerProfileForm } from '@/app/(app)/creators/workspace/profile-actions';
import { MakerProfileError } from '@/lib/makers/profile';

/** docs/PLATFORM-2.0.md §7.5 — the profile form's boundary: session identity, server gates, codes only. */
const viewer = { tier: 'free', userId: 'f0000000-0000-4000-8000-000000000002', email: null, isAdmin: false, locale: 'ko' };
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(fields)) data.set(k, v); return data; };
const target = async (data: FormData) => { try { await saveMakerProfileForm(data); } catch (error) { return (error as { to: string }).to; } throw Error('no redirect'); };

beforeEach(() => {
  vi.clearAllMocks();
  mock.viewer.mockResolvedValue(viewer);
  mock.sql.mockResolvedValue({});
  mock.access.mockResolvedValue({ creators: true });
  mock.load.mockResolvedValue({ handle: 'old_name', bio: null, publicProfile: true });
  mock.save.mockResolvedValue({ handle: 'jun_01', bio: null, publicProfile: true });
});

describe('maker profile server action', () => {
  it('saves for the session user, refreshes old and new maker pages, and redirects without the answers', async () => {
    const to = await target(form({ handle: 'jun_01', bio: 'PRIVATE_BIO', publicProfile: 'on', userId: 'someone-else' }));
    expect(to).toBe('/creators/workspace?ok=profile#profile');
    expect(mock.save).toHaveBeenCalledWith({}, viewer.userId, { handle: 'jun_01', bio: 'PRIVATE_BIO', publicProfile: true });
    expect(mock.revalidate).toHaveBeenCalledWith(['old_name', 'jun_01']);
    expect(to).not.toContain('PRIVATE_BIO');
  });

  it('reads an unchecked box as "off"', async () => {
    await target(form({ handle: 'jun_01', bio: '' }));
    expect(mock.save).toHaveBeenCalledWith({}, viewer.userId, { handle: 'jun_01', bio: '', publicProfile: false });
  });

  it('never touches the database anonymously, and refuses while the maker gate is closed', async () => {
    mock.viewer.mockResolvedValue({ ...viewer, userId: null });
    expect(await target(form({ handle: 'jun_01' }))).toBe('/creators/workspace?profile=sign_in_required#profile');
    expect(mock.sql).not.toHaveBeenCalled();
    mock.viewer.mockResolvedValue(viewer);
    mock.access.mockResolvedValue({ creators: false });
    expect(await target(form({ handle: 'jun_01' }))).toBe('/creators/workspace?profile=not_maker#profile');
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('maps refusals to codes and hides anything unexpected', async () => {
    mock.save.mockRejectedValueOnce(new MakerProfileError('handle_taken'));
    expect(await target(form({ handle: 'jun_01' }))).toBe('/creators/workspace?profile=handle_taken#profile');
    mock.save.mockRejectedValueOnce(new Error('connection reset with SECRET detail'));
    const to = await target(form({ handle: 'jun_01' }));
    expect(to).toBe('/creators/workspace?profile=unavailable#profile');
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
});
