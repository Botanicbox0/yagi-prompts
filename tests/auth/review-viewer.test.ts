import { describe, expect, it } from 'vitest';
import { resolveViewer } from '@/lib/auth/identity';

/**
 * The 심사 계정 marker (docs/qa/toss-checkout/REVIEW-ACCOUNT.md). It comes from the auth server's
 * `app_metadata.purpose`, it grants no tier and no admin, and `canStartRender` is the only thing
 * that may read it — under `RENDER_PIPELINE_PUBLIC=review` and nowhere else.
 */
const identity = { isAdmin: false, locale: null, email: 'pg-review@twings.app', subscriptionStatus: null };

describe('review account marker', () => {
  it('is carried only when the auth server said so, and never widens the tier', () => {
    const marked = resolveViewer({ id: 'u1' }, identity, { review: true });
    expect(marked.review).toBe(true);
    expect(marked.tier).toBe('free');
    expect(marked.isAdmin).toBe(false);

    expect(resolveViewer({ id: 'u1' }, identity).review).toBe(false);
    expect(resolveViewer({ id: 'u1' }, identity, {}).review).toBe(false);
  });

  it('is never set on an admin, so the narrow path can never widen an already-wide one', () => {
    const admin = resolveViewer({ id: 'u2' }, { ...identity, isAdmin: true }, { review: true });
    expect(admin.review).toBe(false);
    expect(admin.tier).toBe('admin');
  });

  it('stays absent for anonymous', () => {
    expect(resolveViewer(null, null, { review: true }).review).toBeFalsy();
  });

  it('does not make an entitled reader out of a review account', () => {
    const paid = resolveViewer({ id: 'u3' }, { ...identity, subscriptionStatus: 'active' }, { review: true });
    // The marker is orthogonal: entitlement still comes from the subscription row alone.
    expect(paid.tier).toBe('pro');
    expect(paid.review).toBe(true);
  });
});
