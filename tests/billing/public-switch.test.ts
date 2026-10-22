import { describe, expect, it, vi } from 'vitest';
import { renderPipelineMode, renderPipelinePublic, tossKeyKind } from '@/lib/flags';
import { purchaseOpenFor, storefrontOpen } from '@/lib/auth/purchase-gate';
import { tossConfigFromEnv } from '@/lib/billing/toss-gateway';
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

/**
 * docs/PLATFORM-2.0.md §2.2-3 — the switch and the gateway read keys by ONE rule. `live_` alone used
 * to open the sale on an API key pair (`live_ck_`/`live_sk_`) that the payment-widget gateway then
 * refused: an open storefront whose every payment failed.
 */
const API_KEYS = { TOSS_CLIENT_KEY: 'live_ck_example', TOSS_SECRET_KEY: 'live_sk_example' };
const DOCS = { TOSS_CLIENT_KEY: 'test_gck_docs_example', TOSS_SECRET_KEY: 'test_gsk_docs_example' };
const logger = () => ({ warn: vi.fn(), error: vi.fn() });
const printed = (log: ReturnType<typeof logger>) =>
  [...log.warn.mock.calls, ...log.error.mock.calls].flat().map(String).join('\n');

describe('the key rule', () => {
  it('is the gateway’s: a widget client key and a secret key of the same kind', () => {
    const pairs: Array<Record<string, string>> = [
      LIVE, TEST, API_KEYS, DOCS, {},
      { TOSS_CLIENT_KEY: LIVE.TOSS_CLIENT_KEY },
      { TOSS_CLIENT_KEY: LIVE.TOSS_CLIENT_KEY, TOSS_SECRET_KEY: TEST.TOSS_SECRET_KEY },
      { TOSS_CLIENT_KEY: TEST.TOSS_CLIENT_KEY, TOSS_SECRET_KEY: LIVE.TOSS_SECRET_KEY },
      { TOSS_CLIENT_KEY: ` ${LIVE.TOSS_CLIENT_KEY} `, TOSS_SECRET_KEY: ` ${LIVE.TOSS_SECRET_KEY}\n` },
    ];
    for (const pair of pairs) {
      let gateway: string | null;
      try {
        gateway = tossConfigFromEnv({ NODE_ENV: 'test', ...pair })?.kind ?? null;
      } catch {
        gateway = null;
      }
      expect(tossKeyKind(pair), JSON.stringify(Object.keys(pair))).toBe(gateway);
    }
  });

  it('keeps production `on` closed on an API key pair the widget gateway refuses', () => {
    const log = logger();
    expect(renderPipelineMode({ ...API_KEYS, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' }, log)).toBe('off');
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(printed(log)).not.toContain('example');
    expect(renderPipelineMode({ ...LIVE, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' }, logger())).toBe('on');
  });
});

describe('review in production', () => {
  it('opens only on a test key pair; live keys or none close it with one error line and no key value', () => {
    for (const keys of [LIVE, {}, API_KEYS]) {
      const log = logger();
      expect(renderPipelineMode({ ...keys, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'review' }, log)).toBe('off');
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(printed(log)).not.toMatch(/example|live_gck|live_gsk/);
    }
    const quiet = logger();
    expect(renderPipelineMode({ ...TEST, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'review' }, quiet)).toBe('review');
    expect(quiet.error).not.toHaveBeenCalled();
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it('stays as it was outside production: preview and local runs open review for QA', () => {
    expect(renderPipelineMode({ ...LIVE, VERCEL_ENV: 'preview', RENDER_PIPELINE_PUBLIC: 'review' }, logger())).toBe('review');
    expect(renderPipelineMode({ RENDER_PIPELINE_PUBLIC: 'review' }, logger())).toBe('review');
  });

  it('warns, without closing, on a docs example key — it leaves no transaction at this shop', () => {
    const log = logger();
    expect(renderPipelineMode({ ...DOCS, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'review' }, log)).toBe('review');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(printed(log)).not.toContain('docs_example');
  });

  it('says nothing while the switch is off', () => {
    const log = logger();
    expect(renderPipelineMode({ ...DOCS, VERCEL_ENV: 'production' }, log)).toBe('off');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});
