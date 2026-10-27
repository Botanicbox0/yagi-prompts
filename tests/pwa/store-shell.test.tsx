import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
import { middleware } from '@/middleware';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { DEFAULT_ANDROID_PACKAGE } from '@/lib/mobile/store-bridge';
import { STORE_SHELL_ATTRIBUTE, STORE_SHELL_KEY, androidPackageName, storeShellScript } from '@/lib/mobile/store-shell';
import { StoreCheckoutNote, StoreShellGate } from '@/components/pwa/store-shell';

/**
 * docs/PLATFORM-2.0.md §5.1 (founder decision 2026-10-28) — the Google Play app is a TWA that sells
 * nothing. The page recognises it from the launch URL, the app's own referrer, or this tab's memory,
 * and never from anything shared with the user's ordinary Chrome.
 */

interface Page {
  search?: string;
  referrer?: string;
  stored?: Record<string, string>;
  storageThrows?: boolean;
}

function run(page: Page, script = storeShellScript(DEFAULT_ANDROID_PACKAGE)) {
  const attributes = new Map<string, string>();
  const stored = new Map(Object.entries(page.stored ?? {}));
  const sessionStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  };
  const window = page.storageThrows
    ? Object.defineProperty({}, 'sessionStorage', { get() { throw new Error('SecurityError'); } })
    : { sessionStorage };
  runInNewContext(script, {
    window,
    location: { search: page.search ?? '' },
    document: {
      referrer: page.referrer ?? '',
      documentElement: { setAttribute: (name: string, value: string) => void attributes.set(name, value) },
    },
    URLSearchParams,
  });
  return { shell: attributes.get(STORE_SHELL_ATTRIBUTE) ?? null, stored: Object.fromEntries(stored) };
}

describe('the Google Play app is recognised in the page', () => {
  it('from the launch URL, and remembers it for this tab only', () => {
    expect(run({ search: '?source=twa' })).toEqual({ shell: 'android', stored: { [STORE_SHELL_KEY]: 'android' } });
    // The installed PWA and a browser tab carry their own markers, or none.
    expect(run({ search: '?source=pwa' })).toEqual({ shell: null, stored: {} });
    expect(run({})).toEqual({ shell: null, stored: {} });
  });

  it('from the app’s own referrer, with or without the trailing slash', () => {
    expect(run({ referrer: `android-app://${DEFAULT_ANDROID_PACKAGE}/` }).shell).toBe('android');
    expect(run({ referrer: `android-app://${DEFAULT_ANDROID_PACKAGE}` }).shell).toBe('android');
  });

  it('not from another app’s referrer, nor a package that merely starts the same', () => {
    expect(run({ referrer: 'android-app://com.kakao.talk/' }).shell).toBeNull();
    expect(run({ referrer: `android-app://${DEFAULT_ANDROID_PACKAGE}evil/` }).shell).toBeNull();
    expect(run({ referrer: 'https://twings.app/ko' }).shell).toBeNull();
  });

  it('keeps the answer across the tab’s later pages', () => {
    expect(run({ stored: { [STORE_SHELL_KEY]: 'android' } }).shell).toBe('android');
  });

  it('still answers from the launch when storage is blocked', () => {
    expect(run({ search: '?source=twa', storageThrows: true }).shell).toBe('android');
    expect(run({ storageThrows: true }).shell).toBeNull();
  });

  it('writes only a real package name into the script', () => {
    expect(androidPackageName({})).toBe(DEFAULT_ANDROID_PACKAGE);
    expect(androidPackageName({ ANDROID_PACKAGE_NAME: 'com.yagi.twings' })).toBe('com.yagi.twings');
    expect(androidPackageName({ ANDROID_PACKAGE_NAME: "x');alert(1);//" })).toBe(DEFAULT_ANDROID_PACKAGE);
    const script = storeShellScript("x');alert(1);//");
    expect(script).not.toContain('alert');
    expect(run({ referrer: `android-app://${DEFAULT_ANDROID_PACKAGE}/` }, script).shell).toBe('android');
  });
});

describe('what the app hides, and what it says instead', () => {
  it('hides purchase surfaces and shows the note only under html[data-store-shell]', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/html\[data-store-shell\] \[data-store-hide\] \{\s*display: none !important;/);
    expect(css).toMatch(/\[data-store-note\] \{\s*display: none;/);
    expect(css).toMatch(/html\[data-store-shell\] \[data-store-note\] \{\s*display: block;/);
  });

  it('renders no checkout before the page has looked, so the Toss script is never fetched in the app', () => {
    const html = renderToStaticMarkup(
      <StoreShellGate fallback={<p>note</p>}>
        <div data-toss-checkout />
      </StoreShellGate>,
    );
    expect(html).toBe('');
  });

  it('says it in two sentences with no link (Play Payments policy: text only)', () => {
    for (const locale of ['ko', 'en'] as const) {
      const store = getDictionary(locale).appShell.store;
      const html = renderToStaticMarkup(<StoreCheckoutNote title={store.checkoutTitle} body={store.checkoutBody} />);
      expect(html).toContain('data-store-checkout-note');
      expect(html).not.toContain('<a');
      for (const line of [store.note, store.checkoutTitle, store.checkoutBody]) expect(line).not.toMatch(/https?:|twings\.app/);
    }
  });
});

describe('the Play app’s launch URLs', () => {
  const twa = JSON.parse(readFileSync(join(process.cwd(), 'mobile', 'twa-manifest.json'), 'utf8')) as {
    packageId: string;
    startUrl: string;
    shortcuts: Array<{ url: string }>;
    features: { playBilling: { enabled: boolean } };
    enableNotifications: boolean;
  };

  it('all carry the launch marker, under the package the page checks', () => {
    expect(twa.packageId).toBe(DEFAULT_ANDROID_PACKAGE);
    expect(new URL(twa.startUrl, 'https://twings.app').searchParams.get('source')).toBe('twa');
    for (const shortcut of twa.shortcuts) expect(new URL(shortcut.url).searchParams.get('source'), shortcut.url).toBe('twa');
  });

  it('sells nothing and keeps the completion push', () => {
    expect(twa.features.playBilling.enabled).toBe(false);
    expect(twa.enableNotifications).toBe(true);
  });

  it('keeps the marker when a signed-out shortcut is sent to sign in', async () => {
    const request = (path: string) => new NextRequest(`https://twings.app${path}`, { headers: { host: 'twings.app' } });
    const fromApp = new URL((await middleware(request('/renders?source=twa'))).headers.get('location')!);
    expect(fromApp.searchParams.get('source')).toBe('twa');
    expect(fromApp.searchParams.get('next')).toBe('/renders?source=twa');
    const fromBrowser = new URL((await middleware(request('/renders'))).headers.get('location')!);
    expect(fromBrowser.searchParams.has('source')).toBe(false);
  });
});
