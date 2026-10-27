import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ createOrder: vi.fn(), beginSubscription: vi.fn(), enqueue: vi.fn(), getViewer: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: state.getViewer }));
vi.mock('@/lib/billing/toss-runtime', () => ({
  isSameOrigin: (r: Request) => r.headers.get('origin') === new URL(r.url).origin,
  getTossContext: async () => null,
  TOSS_HEADERS: { 'Cache-Control': 'private, no-store' },
}));
vi.mock('@/lib/billing/toss-service', () => ({ createTossOrder: state.createOrder, retryTossOrder: state.createOrder }));
vi.mock('@/lib/renders/service', () => ({ canStartRender: () => true, createSubscriptionRenderJob: state.enqueue }));
vi.mock('@/lib/identity/selfie-service', () => ({ savedSelfiePhoto: async () => null }));
vi.mock('@/lib/creator-subscriptions/runtime', () => ({
  getSubscriptionContext: async () => null,
  liveSubscriptionAvailability: async () => null,
  subscriptionLiveQaReady: async () => false,
  premiumEditingOperational: async () => false,
  SUBSCRIPTION_HEADERS: { 'Cache-Control': 'private, no-store' },
}));
vi.mock('@/lib/creator-subscriptions/service', () => ({ beginSubscription: state.beginSubscription }));

import {
  buildAppleAppSiteAssociation,
  isStoreRequest,
  STORE_CLIENT_HEADER,
  STORE_CLIENT_KEY,
  STORE_CLIENT_SCRIPT,
  storeClientHeaderValue,
} from '@/lib/mobile/store-bridge';
import { isStandaloneDisplay } from '@/components/pwa/display-mode';
import { POST as postOrder } from '@/app/api/billing/toss/orders/route';
import { POST as postRetry } from '@/app/api/billing/toss/orders/[id]/retry/route';
import { POST as postSubscription } from '@/app/api/creator-subscriptions/route';
import { POST as postSubscriptionRender } from '@/app/api/creator-subscriptions/renders/route';

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

/** Runs the inline head script against a fake page and returns what it left on `<html>`. */
function runScript(page: { ua?: string; search?: string; referrer?: string; stored?: string | null; storage?: 'ok' | 'blocked' }) {
  const attributes = new Map<string, string>();
  const store = new Map<string, string>(page.stored ? [[STORE_CLIENT_KEY, page.stored]] : []);
  const blocked = () => { throw new Error('SecurityError'); };
  const sessionStorage = page.storage === 'blocked'
    ? { getItem: blocked, setItem: blocked }
    : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const document = { documentElement: { setAttribute: (k: string, v: string) => void attributes.set(k, v) }, referrer: page.referrer ?? '' };
  new Function('document', 'navigator', 'location', 'sessionStorage', STORE_CLIENT_SCRIPT)(
    document, { userAgent: page.ua ?? CHROME }, { search: page.search ?? '' }, sessionStorage,
  );
  return { store: attributes.get('data-store') ?? null, standalone: attributes.has('data-standalone'), remembered: store.get(STORE_CLIENT_KEY) ?? null };
}

describe('store binary marker (inline head script)', () => {
  it('marks the Capacitor apps by their user agent', () => {
    expect(runScript({ ua: `${CHROME} TwingsIOS/1.0` })).toMatchObject({ store: 'ios-store', standalone: true });
    expect(runScript({ ua: `${CHROME} TwingsAndroid/1.0` })).toMatchObject({ store: 'android-store', standalone: true });
  });

  it('marks the TWA from its start URL and remembers it for the rest of that tab', () => {
    expect(runScript({ search: '?source=twa' })).toEqual({ store: 'android-store', standalone: true, remembered: 'android-store' });
    // The next page inside the TWA has no query any more; sessionStorage carries it.
    expect(runScript({ search: '', stored: 'android-store' })).toMatchObject({ store: 'android-store' });
    expect(runScript({ referrer: 'android-app://app.twings.client/' })).toMatchObject({ store: 'android-store' });
  });

  it('leaves ordinary visitors able to pay — including links opened from other Android apps', () => {
    expect(runScript({})).toEqual({ store: null, standalone: false, remembered: null });
    expect(runScript({ search: '?source=pwa' })).toMatchObject({ store: null });
    expect(runScript({ referrer: 'android-app://com.google.android.gm/' })).toMatchObject({ store: null });
    expect(runScript({ referrer: 'https://www.instagram.com/' })).toMatchObject({ store: null });
    // A forged value in storage is ignored.
    expect(runScript({ stored: 'admin' })).toMatchObject({ store: null });
  });

  it('survives blocked storage without breaking the page', () => {
    expect(runScript({ storage: 'blocked', ua: `${CHROME} TwingsIOS/1.0` })).toMatchObject({ store: 'ios-store' });
    expect(runScript({ storage: 'blocked', search: '?source=twa' })).toMatchObject({ store: 'android-store' });
    expect(runScript({ storage: 'blocked' })).toMatchObject({ store: null });
  });

  it('treats a store binary as the installed app (bottom tabs, safe areas)', () => {
    expect(isStandaloneDisplay({ store: true, matchMedia: () => ({ matches: false }) })).toBe(true);
    expect(isStandaloneDisplay({ store: false, matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it('reads the header value only from the two store markers', () => {
    const root = (value: string | null) => ({ getAttribute: () => value });
    expect(storeClientHeaderValue(root('android-store'))).toBe('android-store');
    expect(storeClientHeaderValue(root('ios-store'))).toBe('ios-store');
    expect(storeClientHeaderValue(root('web'))).toBeNull();
    expect(storeClientHeaderValue(root(null))).toBeNull();
    expect(storeClientHeaderValue(null)).toBeNull();
  });
});

describe('server half of the companion rule', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('recognises store binaries by user agent or the client header', () => {
    expect(isStoreRequest(headers({ 'user-agent': `${CHROME} TwingsIOS/1.0` }))).toBe(true);
    expect(isStoreRequest(headers({ 'user-agent': CHROME, [STORE_CLIENT_HEADER]: 'android-store' }))).toBe(true);
    expect(isStoreRequest(headers({ 'user-agent': CHROME }))).toBe(false);
    expect(isStoreRequest(headers({ 'user-agent': CHROME, [STORE_CLIENT_HEADER]: 'web' }))).toBe(false);
  });

  const post = (url: string, extra: Record<string, string>, body: BodyInit = new FormData()) =>
    new Request(url, { method: 'POST', headers: { origin: 'https://twings.app', ...extra }, body });

  beforeEach(() => {
    vi.clearAllMocks();
    state.getViewer.mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111', isAdmin: false });
  });

  it('refuses every charge-starting route from a store binary before reading the viewer', async () => {
    const ios = { 'user-agent': `${CHROME} TwingsIOS/1.0` };
    const twa = { 'user-agent': CHROME, [STORE_CLIENT_HEADER]: 'android-store' };
    const order = await postOrder(post('https://twings.app/api/billing/toss/orders', ios));
    expect(order.status).toBe(403);
    expect(await order.json()).toEqual({ ok: false, code: 'store_companion' });
    const retry = await postRetry(post('https://twings.app/api/billing/toss/orders/x/retry', twa), { params: Promise.resolve({ id: 'x' }) });
    expect(retry.status).toBe(403);
    const enrol = await postSubscription(post('https://twings.app/api/creator-subscriptions', twa, JSON.stringify({ planId: 'creator', consent: true, consentVersion: 'v' })));
    expect(enrol.status).toBe(403);
    expect(await enrol.json()).toMatchObject({ code: 'store_companion' });
    const render = await postSubscriptionRender(post('https://twings.app/api/creator-subscriptions/renders', ios));
    expect(render.status).toBe(403);
    expect(state.getViewer).not.toHaveBeenCalled();
    expect(state.createOrder).not.toHaveBeenCalled();
    expect(state.beginSubscription).not.toHaveBeenCalled();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('lets the same routes through for a browser or installed PWA (they fail later on the mocks, not on the store rule)', async () => {
    const order = await postOrder(post('https://twings.app/api/billing/toss/orders', { 'user-agent': CHROME }));
    expect(await order.json()).not.toMatchObject({ code: 'store_companion' });
    expect(state.getViewer).toHaveBeenCalled();
  });
});

describe('store binary configuration', () => {
  it('keeps web checkout returns and the price page out of the iOS app', () => {
    const components = buildAppleAppSiteAssociation({}).applinks.details[0]!.components;
    const firstMatch = (pathname: string) => components.find((c) => {
      const pattern = c['/'];
      return pattern.endsWith('/*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
    });
    expect(firstMatch('/billing/toss/return')?.exclude).toBe(true);
    expect(firstMatch('/billing/success')?.exclude).toBe(true);
    expect(firstMatch('/ko/pricing')?.exclude).toBe(true);
    expect(firstMatch('/en/pricing')?.exclude).toBe(true);
    expect(firstMatch('/ko/video')?.exclude).toBeUndefined();
    expect(firstMatch('/renders/abc')?.exclude).toBeUndefined();
  });

  it('starts the TWA (and its shortcuts) on a URL the head script recognises', () => {
    const twa = JSON.parse(readFileSync(path.join(process.cwd(), 'mobile/twa-manifest.json'), 'utf8')) as { startUrl: string; shortcuts: Array<{ url: string }> };
    expect(new URL(twa.startUrl, 'https://twings.app').searchParams.get('source')).toBe('twa');
    for (const shortcut of twa.shortcuts) expect(new URL(shortcut.url).searchParams.get('source')).toBe('twa');
  });

  it('hides every purchase surface under html[data-store]', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    const rule = css.slice(css.indexOf('html[data-store] :is('), css.indexOf('display: none !important', css.indexOf('html[data-store] :is(')));
    for (const marker of ['[data-template-make]', '[data-twings-studio]', '[data-make-sticky]', '[data-make-cta]', '[data-subscription-preview]', '[data-creator-pricing]', "a[href$='/pricing']"]) {
      expect(rule).toContain(marker);
    }
  });
});
