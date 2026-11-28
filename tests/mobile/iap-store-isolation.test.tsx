import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMock = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: routeMock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: routeMock.sql }));

import { ANON_VIEWER } from '@/lib/auth/identity';
import { isAuthProvider, needsRealBrowser, providersForLocale } from '@/lib/auth/providers';
import { isCapacitorShellWebView, isEmbeddedWebView } from '@/lib/auth/webview';
import { bottomTabItems } from '@/components/app/bottom-tabs';
import { TwingsStudio, type StudioLabels, type StudioLive, type StudioStyle } from '@/components/twings/studio';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { creditsRequiredForKrw, STORE_IAP_PACKS } from '@/lib/mobile/iap/catalog';
import { getStoreWalletBalance, verifyAndCreditStorePurchase } from '@/lib/mobile/iap/verify';
import { detectStorePlatform, isNativeStoreApp } from '@/lib/mobile/store-bridge';
import { createStoreIapRenderJob } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { GET as verifyGET, POST as verifyPOST } from '@/app/api/mobile/iap/verify/route';
import { POST as iapRenderPOST } from '@/app/api/mobile/iap/renders/route';
import { viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import capacitorJson from '@/mobile/capacitor.config.json';
import capacitorTs from '@/capacitor.config';

const en = getDictionary('en');
const studioLabels: StudioLabels = {
  stepPhoto: en.studio.stepPhoto,
  stepStyle: en.studio.stepStyle,
  stepPay: en.studio.stepPay,
  stepResult: en.studio.stepResult,
  dropZone: en.studio.dropZone,
  dropHint: en.studio.dropHint,
  changePhoto: en.studio.changePhoto,
  chooseStyle: en.studio.chooseStyle,
  payCta: en.studio.payCta,
  payNote: en.studio.payNote,
  closedTitle: en.studio.closedTitle,
  closedBody: en.studio.closedBody,
  closedCta: en.studio.closedCta,
  closedDone: en.studio.closedDone,
  runtimeLabel: en.studio.runtimeLabel,
  needPhoto: en.studio.needPhoto,
  noStyles: en.studio.noStyles,
  moreTemplates: en.studio.moreTemplates,
  aspectLabel: en.studio.aspectLabel,
  pending: en.studio.pending,
};

const studioLive: StudioLive = {
  endpoint: '/api/renders',
  accessEndpoint: '/api/renders/access',
  interestEndpoint: '/api/notify/interest',
  template: 'seoul-90s',
  locale: 'en',
  signinHref: '/auth/signin?next=%2Fen%2Ft%2Fseoul-90s',
  identityHref: '/identity/verify',
  labels: {
    badge: en.renders.studio.badge,
    operatorBadge: en.renders.studio.operatorBadge,
    freeCta: en.renders.studio.freeCta,
    submitting: en.renders.studio.submitting,
    identityNotice: en.renders.studio.identityNotice,
    identityPending: en.renders.studio.identityPending,
    identityCta: en.renders.studio.identityCta,
    errors: en.renders.studio.errors,
  },
};

const studioStyles: StudioStyle[] = [
  {
    id: 'seoul-90s',
    title: '90s Seoul Interview',
    price: '$4',
    runtime: '15',
    blurb: '1994 Seoul',
    posterSrc: '/p.jpg',
    videoSrc: '/v.mp4',
    moreHref: '/en/video',
    aspects: [{ id: '9:16', label: '9:16' }],
    defaultAspect: '9:16',
  },
];

describe('Mobile store isolation, native IAP ledger & Apple auth gating', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;
  const prevPublic = process.env.RENDER_PIPELINE_PUBLIC;
  const prevSecret = process.env.STORE_IAP_SANDBOX_SECRET;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.RENDER_PIPELINE_PUBLIC = 'on';
    process.env.STORE_IAP_SANDBOX_SECRET = 'sandbox-test-secret-0123456789';
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-iap-'));
    store = createLocalRenderStore(root);
    routeMock.sql.mockResolvedValue(h.sql);
    routeMock.viewer.mockResolvedValue(viewerOf('free'));
  });

  afterEach(async () => {
    if (prevPublic === undefined) delete process.env.RENDER_PIPELINE_PUBLIC;
    else process.env.RENDER_PIPELINE_PUBLIC = prevPublic;
    if (prevSecret === undefined) delete process.env.STORE_IAP_SANDBOX_SECRET;
    else process.env.STORE_IAP_SANDBOX_SECRET = prevSecret;
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('rejects all /api/mobile/iap/* calls from web and PWA browsers with 403 native_store_only', async () => {
    const webUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

    const getRes = await verifyGET(
      new Request('https://twings.app/api/mobile/iap/verify', {
        headers: { 'user-agent': webUa },
      }),
    );
    expect(getRes.status).toBe(403);
    expect(await getRes.json()).toEqual({ ok: false, code: 'native_store_only' });

    const postRes = await verifyPOST(
      new Request('https://twings.app/api/mobile/iap/verify', {
        method: 'POST',
        headers: { 'user-agent': webUa, 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 'twings.credits.1000', transactionId: 'tx-web-1' }),
      }),
    );
    expect(postRes.status).toBe(403);
    expect(await postRes.json()).toEqual({ ok: false, code: 'native_store_only' });

    const renderRes = await iapRenderPOST(
      new Request('https://twings.app/api/mobile/iap/renders', {
        method: 'POST',
        headers: { 'user-agent': webUa },
      }),
    );
    expect(renderRes.status).toBe(403);
    expect(await renderRes.json()).toEqual({ ok: false, code: 'native_store_only' });
  });

  it('recognizes TwingsIOS, TwingsAndroid, and TwingsApp store shell UAs and allows GET/POST verify', async () => {
    expect(detectStorePlatform({ userAgent: 'Mozilla/5.0 TwingsApp/1.0 (iOS)' })).toBe('ios-store');
    expect(detectStorePlatform({ userAgent: 'Mozilla/5.0 TwingsApp/1.0 (Android)' })).toBe(
      'android-store',
    );
    expect(isNativeStoreApp('ios-store')).toBe(true);
    expect(isNativeStoreApp('web')).toBe(false);

    routeMock.viewer.mockResolvedValueOnce(ANON_VIEWER);
    const anonRes = await verifyGET(
      new Request('https://twings.app/api/mobile/iap/verify', {
        headers: { 'user-agent': 'Mozilla/5.0 TwingsIOS/1.0' },
      }),
    );
    expect(anonRes.status).toBe(401);

    const postRes = await verifyPOST(
      new Request('https://twings.app/api/mobile/iap/verify', {
        method: 'POST',
        headers: {
          'user-agent': 'Mozilla/5.0 TwingsIOS/1.0',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          productId: 'twings.credits.3000',
          transactionId: 'apple-tx-300',
          purchaseToken: 'sandbox-test-secret-0123456789',
          environment: 'sandbox',
        }),
      }),
    );
    expect(postRes.status).toBe(201);
    const credited = await postRes.json();
    expect(credited).toMatchObject({
      ok: true,
      idempotent: false,
      platform: 'ios',
      productId: 'twings.credits.3000',
      creditsAdded: 300,
      balance: 300,
    });

    const getRes = await verifyGET(
      new Request('https://twings.app/api/mobile/iap/verify', {
        headers: { 'user-agent': 'Mozilla/5.0 TwingsIOS/1.0' },
      }),
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({
      ok: true,
      platform: 'ios-store',
      balance: 300,
    });
  });

  it('fails closed in production verifier, keeps purchases idempotent, and rejects stolen transactionIds', async () => {
    const memberA = viewerOf('free');
    const memberB = viewerOf('pro');

    const failClosed = await verifyAndCreditStorePurchase(h.sql, {
      userId: memberA.userId!,
      storePlatform: 'ios-store',
      productId: 'twings.credits.1000',
      transactionId: 'prod-tx-1',
      environment: 'production',
    });
    expect(failClosed).toEqual({ ok: false, code: 'iap_verifier_unconfigured' });

    const okVerifier = async () => ({ ok: true as const, environment: 'production' as const });
    const first = await verifyAndCreditStorePurchase(
      h.sql,
      {
        userId: memberA.userId!,
        storePlatform: 'android-store',
        productId: 'twings.credits.5000',
        transactionId: 'play-tx-500',
      },
      { verifier: okVerifier },
    );
    expect(first).toMatchObject({ ok: true, idempotent: false, creditsAdded: 500, balance: 500 });

    const replay = await verifyAndCreditStorePurchase(
      h.sql,
      {
        userId: memberA.userId!,
        storePlatform: 'android-store',
        productId: 'twings.credits.5000',
        transactionId: 'play-tx-500',
      },
      { verifier: okVerifier },
    );
    expect(replay).toMatchObject({ ok: true, idempotent: true, creditsAdded: 0, balance: 500 });

    const theft = await verifyAndCreditStorePurchase(
      h.sql,
      {
        userId: memberB.userId!,
        storePlatform: 'android-store',
        productId: 'twings.credits.5000',
        transactionId: 'play-tx-500',
      },
      { verifier: okVerifier },
    );
    expect(theft).toEqual({ ok: false, code: 'transaction_conflict' });
  });

  it('atomically debits wallet credits when enqueueing a native store render and stays idempotent per requestId', async () => {
    const member = viewerOf('free');
    const { rows } = await h.sql.query<{
      slug: string;
      price_krw: number;
      aspect_default: string;
    }>(
      "select slug, price_krw, coalesce(aspect_default, '9:16') as aspect_default from prompt_items where status = 'published' and audience = 'public' and price_cents > 0 and price_krw > 0 and coalesce(cast_kind, 'solo') = 'solo' order by slug asc limit 1",
    );
    const tpl = rows[0]!;
    const needed = creditsRequiredForKrw(Number(tpl.price_krw));
    expect(needed).toBeGreaterThanOrEqual(10);

    const requestId = randomUUID();
    const closed = await createStoreIapRenderJob(
      { sql: h.sql, store, mode: 'virtual', pipelineMode: 'off' },
      member,
      {
        storePlatform: 'ios-store',
        requestId,
        templateSlug: tpl.slug,
        aspect: tpl.aspect_default,
        photo: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' },
        locale: 'ko',
      },
    );
    expect(closed).toEqual({ ok: false, code: 'not_open' });

    const insufficient = await createStoreIapRenderJob(
      { sql: h.sql, store, mode: 'virtual', pipelineMode: 'on' },
      member,
      {
        storePlatform: 'ios-store',
        requestId,
        templateSlug: tpl.slug,
        aspect: tpl.aspect_default,
        photo: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' },
        locale: 'ko',
      },
    );
    expect(insufficient).toMatchObject({
      ok: false,
      code: 'insufficient_credits',
      balance: 0,
    });

    await verifyAndCreditStorePurchase(
      h.sql,
      {
        userId: member.userId!,
        storePlatform: 'ios-store',
        productId: 'twings.credits.10000',
        transactionId: 'ios-pack-1000',
      },
      { verifier: async () => ({ ok: true as const }) },
    );

    const created = await createStoreIapRenderJob(
      { sql: h.sql, store, mode: 'virtual', pipelineMode: 'on' },
      member,
      {
        storePlatform: 'ios-store',
        requestId,
        templateSlug: tpl.slug,
        aspect: tpl.aspect_default,
        photo: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' },
        locale: 'ko',
      },
    );
    expect(created).toMatchObject({ ok: true, held: false });
    if (created.ok) {
      expect(created.creditsSpent).toBeGreaterThan(0);
      expect(created.balance).toBe(1000 - created.creditsSpent);
      expect(await getStoreWalletBalance(h.sql, member.userId!)).toBe(created.balance);

      const duplicate = await createStoreIapRenderJob(
        { sql: h.sql, store, mode: 'virtual', pipelineMode: 'on' },
        member,
        {
          storePlatform: 'ios-store',
          requestId,
          templateSlug: tpl.slug,
          aspect: tpl.aspect_default,
          photo: { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png' },
          locale: 'ko',
        },
      );
      expect(duplicate).toMatchObject({
        ok: true,
        id: created.id,
        creditsSpent: created.creditsSpent,
        balance: created.balance,
      });
    }
  });

  it('never renders native IAP credit sheets on web studio, showing them only for native store shells', () => {
    const access = {
      signedIn: true,
      live: true,
      open: true,
      identity: 'active' as const,
      isAdmin: false,
      selfie: null,
    };

    const webHtml = renderToStaticMarkup(
      <TwingsStudio
        styles={studioStyles}
        labels={studioLabels}
        initialStyleId="seoul-90s"
        live={studioLive}
        initialAccess={access}
      />,
    );
    expect(webHtml).not.toContain('data-native-iap-sheet');
    expect(webHtml).not.toContain(STORE_IAP_PACKS[0]!.productId);
    expect(webHtml).toContain(studioLabels.payNote);

    const iosHtml = renderToStaticMarkup(
      <TwingsStudio
        styles={studioStyles}
        labels={studioLabels}
        initialStyleId="seoul-90s"
        live={studioLive}
        initialAccess={access}
        storePlatform="ios-store"
      />,
    );
    expect(iosHtml).toContain('data-native-iap-sheet="ios-store"');
    expect(iosHtml).toContain('twings.credits.1000');
    expect(iosHtml).not.toContain(studioLabels.payNote);
  });

  it('enables Apple Sign In on iOS store shell, extends WebView helper, exposes 4th maker tab, and ships Apple nav allowlist', () => {
    expect(providersForLocale('ko')).toEqual(['google', 'kakao']);
    expect(providersForLocale('ko', { platform: 'ios-store' })).toEqual(['apple', 'google', 'kakao']);
    expect(providersForLocale('en', { platform: 'android-store' })).toEqual(['google', 'kakao']);
    expect(isAuthProvider('apple')).toBe(true);
    expect(needsRealBrowser('apple')).toBe(false);

    expect(isCapacitorShellWebView('Mozilla/5.0 TwingsIOS/1.0')).toBe(true);
    expect(isCapacitorShellWebView('Mozilla/5.0 TwingsAndroid/1.0')).toBe(true);
    expect(isEmbeddedWebView('Mozilla/5.0 TwingsIOS/1.0')).toBe(false);

    const baseTabs = bottomTabItems({
      locale: 'ko',
      pathname: '/ko/video',
      signedIn: true,
      labels: getDictionary('ko').appShell.tabs,
    });
    expect(baseTabs.map((t) => t.id)).toEqual(['formats', 'renders', 'account']);

    const makerTabs = bottomTabItems({
      locale: 'ko',
      pathname: '/creators/workspace',
      signedIn: true,
      labels: getDictionary('ko').appShell.tabs,
      includeMaker: true,
    });
    expect(makerTabs.map((t) => t.id)).toEqual(['formats', 'renders', 'maker', 'account']);
    expect(makerTabs.find((t) => t.id === 'maker')?.current).toBe(true);

    expect(capacitorJson.server.allowNavigation).toContain('appleid.apple.com');
    expect(capacitorTs.server.allowNavigation).toContain('appleid.apple.com');
  });
});
