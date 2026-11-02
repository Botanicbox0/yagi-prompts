import { describe, expect, it } from 'vitest';
import { ENTITLED_STATUSES, isEntitled, planFor } from '@/lib/billing/entitlement';
import {
  checkoutReturnUrls,
  originPath,
  safeInternalPath,
  sanitizeSlug,
  signInHref,
  upgradeHrefFromStatic,
  upgradeIntent,
} from '@/lib/billing/links';
import { TIER_ORDER, type Tier } from '@/lib/content/visibility';

/**
 * PLAN §3.4 — the entitlement definition and the CTA routing that hangs off it.
 *
 * Both are pure, and both are the kind of thing that quietly diverges: an entitlement rule copied
 * into a second file, or a CTA that sends an anonymous reader at a POST route they cannot use.
 */

describe('isEntitled — the ONE definition (§3.4)', () => {
  it('entitles exactly active and past_due', () => {
    expect([...ENTITLED_STATUSES]).toEqual(['active', 'past_due']);
    expect(isEntitled('active')).toBe(true);
    // Stripe owns the retry window; a failed payment does not cut access on our side.
    expect(isEntitled('past_due')).toBe(true);
  });

  it('entitles nothing else Stripe can report', () => {
    for (const status of [
      'canceled',
      'incomplete',
      'incomplete_expired',
      'trialing',
      'unpaid',
      'paused',
      '',
      'ACTIVE',
    ]) {
      expect(isEntitled(status), status).toBe(false);
    }
    expect(isEntitled(null)).toBe(false);
    expect(isEntitled(undefined)).toBe(false);
  });

  it('derives the display mirror from the same rule', () => {
    expect(planFor('active')).toBe('pro');
    expect(planFor('past_due')).toBe('pro');
    expect(planFor('canceled')).toBe('free');
    expect(planFor(null)).toBe('free');
  });

  /**
   * `cancel_at_period_end` is NOT an entitlement input. Stripe keeps the status `active` until the
   * period actually closes and then sends `customer.subscription.deleted`; anything we computed
   * from a local clock would disagree with Stripe for a window, in the direction of cutting a
   * paying customer off early.
   */
  it('ignores cancel_at_period_end entirely — status is the only input', () => {
    expect(isEntitled('active')).toBe(true); // cancel scheduled, still active
    expect(isEntitled('canceled')).toBe(false); // after Stripe transitions it
  });
});

describe('CTA routing (§3.4 conversion path)', () => {
  it('sends an anonymous reader to sign in, and back to where they were', () => {
    const intent = upgradeIntent({
      tier: 'anon',
      slug: 'character-sheet-generation',
      locale: 'ko',
      billingConfigured: true,
    });
    expect(intent.kind).toBe('signin');
    if (intent.kind !== 'signin') return;
    expect(intent.href).toContain('/auth/signin');
    expect(intent.href).toContain(encodeURIComponent('/ko/p/character-sheet-generation'));
    expect(intent.href).toContain('locale=ko');
  });

  it('never sends a signed-in tier to the retired subscription checkout (audit P1-4)', () => {
    for (const tier of TIER_ORDER.filter((t) => t !== 'anon')) {
      for (const billingConfigured of [true, false]) {
        const intent = upgradeIntent({ tier, slug: 'talking-character-clip', locale: 'en', billingConfigured });
        expect(intent.kind, tier).toBe('unavailable');
        if (intent.kind !== 'unavailable') continue;
        expect(intent.href).toBe('/en/pricing');
      }
    }
  });

  it('never points at a dead checkout when Stripe is not configured (§11)', () => {
    for (const tier of TIER_ORDER) {
      const intent = upgradeIntent({
        tier: tier as Tier,
        slug: 'x-y',
        locale: 'en',
        billingConfigured: false,
      });
      // Anonymous readers still sign in first — that is not a purchase, so it is never dead.
      expect(intent.kind === 'signin' || intent.kind === 'unavailable', tier).toBe(true);
      expect(intent.kind).not.toBe('checkout');
    }
  });

  it('routes the static pricing CTA through sign-in with a return-to', () => {
    const href = upgradeHrefFromStatic('ko');
    expect(href).toBe(signInHref('/billing/upgrade?locale=ko', 'ko'));
    expect(href).toContain(encodeURIComponent('/billing/upgrade?locale=ko'));
  });
});

describe('origin carrying (§3.4 "origin slug + locale in metadata")', () => {
  it('accepts real slugs and rejects everything else', () => {
    expect(sanitizeSlug('character-sheet-generation')).toBe('character-sheet-generation');
    expect(sanitizeSlug('a1')).toBe('a1');
    for (const bad of [
      '',
      '/etc/passwd',
      'Upper-Case',
      'trailing-',
      '-leading',
      'double--dash',
      'has space',
      'q?x=1',
      '../escape',
      42,
      null,
      undefined,
    ]) {
      expect(sanitizeSlug(bad), String(bad)).toBeNull();
    }
  });

  it('falls back to the library when there was no origin playbook', () => {
    expect(originPath({ slug: null, locale: 'en' })).toBe('/en/prompts');
    expect(originPath({ slug: 'abc', locale: 'ko' })).toBe('/ko/p/abc');
  });

  it('refuses to turn a query parameter into an open redirect', () => {
    expect(safeInternalPath('/library', '/x')).toBe('/library');
    expect(safeInternalPath('//evil.example/x', '/x')).toBe('/x');
    expect(safeInternalPath('https://evil.example', '/x')).toBe('/x');
    expect(safeInternalPath(undefined, '/x')).toBe('/x');
  });

  it('builds return URLs Stripe can substitute its session id into', () => {
    const { successUrl, cancelUrl } = checkoutReturnUrls('https://playbook.test/', {
      slug: 'voice-identity-setup',
      locale: 'ko',
    });
    expect(successUrl).toBe(
      'https://playbook.test/billing/success?session_id={CHECKOUT_SESSION_ID}&locale=ko&slug=voice-identity-setup',
    );
    expect(cancelUrl).toBe('https://playbook.test/billing/cancelled?locale=ko&slug=voice-identity-setup');
  });

  it('omits the slug when the purchase did not start on a playbook', () => {
    const { successUrl } = checkoutReturnUrls('https://playbook.test', {
      slug: null,
      locale: 'en',
    });
    expect(successUrl).not.toContain('slug=');
  });
});
