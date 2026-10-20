import { describe, expect, it } from 'vitest';
import { renderPipelineMode, renderPipelinePublic } from '@/lib/flags';
import { purchaseOpenFor, storefrontOpen } from '@/lib/auth/purchase-gate';
import type { Viewer } from '@/lib/auth/identity';

/**
 * The public-sales switch (docs/qa/toss-checkout/README.md "운영 개시"). Going live is an
 * environment change in Vercel, not a code deploy — and production refuses to open on Toss TEST
 * keys, because a test key there would hand every visitor a free film.
 */

const LIVE = { TOSS_CLIENT_KEY: 'live_gck_example', TOSS_SECRET_KEY: 'live_gsk_example' };
const TEST = { TOSS_CLIENT_KEY: 'test_gck_example', TOSS_SECRET_KEY: 'test_gsk_example' };

describe('renderPipelinePublic', () => {
  it('is closed unless the environment says exactly on', () => {
    expect(renderPipelinePublic({})).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, VERCEL_ENV: 'production' })).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'yes' })).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: ' ON ' })).toBe(true);
  });

  it('opens production only on live Toss keys, both of them', () => {
    expect(renderPipelinePublic({ ...TEST, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(false);
    expect(renderPipelinePublic({ TOSS_CLIENT_KEY: LIVE.TOSS_CLIENT_KEY, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, TOSS_SECRET_KEY: TEST.TOSS_SECRET_KEY, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(false);
  });

  it('lets a preview or a local run open on test keys, for QA', () => {
    expect(renderPipelinePublic({ ...TEST, VERCEL_ENV: 'preview', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(true);
    expect(renderPipelinePublic({ ...TEST, RENDER_PIPELINE_PUBLIC: 'on' })).toBe(true);
  });
});

/**
 * `review` — the state that makes a PG review winnable. 토스 심사 체크리스트는 테스트 키로 끝낸
 * 결제창 연동을 요구하는데 라이브 키는 승인 뒤에 나온다. 그 교착을 푸는 유일한 통로이며, 통로는
 * 심사 계정 하나로 좁혀져 있어야 한다.
 */
const viewer = (over: Partial<Viewer> = {}): Viewer =>
  ({ tier: 'free', userId: 'u1', email: null, isAdmin: false, locale: null, ...over });

describe('review mode', () => {
  it('is its own state, and never means public sale', () => {
    expect(renderPipelineMode({ ...TEST, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'review' })).toBe('review');
    // The whole point: test keys in production, which `on` refuses.
    expect(renderPipelinePublic({ ...TEST, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'review' })).toBe(false);
    expect(renderPipelineMode({ ...LIVE, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe('on');
    expect(renderPipelineMode({})).toBe('off');
  });

  it('opens the purchase to the marked review account and to nobody else', () => {
    expect(purchaseOpenFor(viewer({ review: true }), 'review')).toBe(true);
    expect(purchaseOpenFor(viewer(), 'review')).toBe(false);
    expect(purchaseOpenFor(viewer({ review: true }), 'off')).toBe(false);
    expect(purchaseOpenFor({ ...viewer({ review: true }), userId: null }, 'review')).toBe(false);
    // `on` is unchanged for everyone; admins keep their free verification path in every mode.
    expect(purchaseOpenFor(viewer(), 'on')).toBe(true);
    expect(purchaseOpenFor(viewer({ isAdmin: true }), 'off')).toBe(true);
  });

  it('opens the storefront copy in review and on, never when off', () => {
    expect(storefrontOpen('review')).toBe(true);
    expect(storefrontOpen('on')).toBe(true);
    expect(storefrontOpen('off')).toBe(false);
  });
});
