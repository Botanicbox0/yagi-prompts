import { describe, expect, it, vi } from 'vitest';
import { authenticateReviewAccount } from '@/lib/auth/review-login';

function fixture() {
  return {
    authenticate: vi.fn(async () => ({ user: { id: 'review-user', app_metadata: { purpose: 'toss_review' } }, session: { access_token: 'test-access', refresh_token: 'test-refresh' } })),
    ordinaryProfile: vi.fn(async () => true),
    commit: vi.fn(async () => true),
  };
}
const input = { email: 'pg-review@twings.app', password: 'test-only-password' };
describe('PG review login uses ordinary authentication and never grants a role', () => {
  it('commits a real session only for a server-marked ordinary review account', async () => {
    const deps = fixture();
    expect(await authenticateReviewAccount(input, deps)).toBe(true);
    expect(deps.authenticate).toHaveBeenCalledWith(input);
    expect(deps.ordinaryProfile).toHaveBeenCalledWith('review-user');
    expect(deps.commit).toHaveBeenCalledOnce();
  });
  it('rejects unrelated email and oversized input before touching auth', async () => {
    for (const bad of [{ ...input, email: 'staff@yagiworkshop.xyz' }, { ...input, password: 'x'.repeat(257) }, { ...input, password: '' }]) {
      const deps = fixture();
      expect(await authenticateReviewAccount(bad, deps)).toBe(false);
      expect(deps.authenticate).not.toHaveBeenCalled();
    }
  });
  it('does not accept an ordinary account without an admin-owned review marker', async () => {
    const deps = fixture();
    deps.authenticate.mockResolvedValue({ user: { id: 'user', app_metadata: { purpose: 'customer' } }, session: { access_token: 'test-access', refresh_token: 'test-refresh' } });
    expect(await authenticateReviewAccount(input, deps)).toBe(false);
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it('refuses an admin or missing profile without persisting tokens', async () => {
    const deps = fixture(); deps.ordinaryProfile.mockResolvedValue(false);
    expect(await authenticateReviewAccount(input, deps)).toBe(false);
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it('fails closed on auth, profile, or session errors', async () => {
    for (const key of ['authenticate', 'ordinaryProfile', 'commit'] as const) {
      const deps = fixture(); deps[key].mockRejectedValue(new Error('provider unavailable'));
      expect(await authenticateReviewAccount(input, deps)).toBe(false);
      if (key !== 'commit') expect(deps.commit).not.toHaveBeenCalled();
    }
  });
});
