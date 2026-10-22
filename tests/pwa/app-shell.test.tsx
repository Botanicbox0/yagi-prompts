import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { BottomTabs, BottomTabsBar, bottomTabItems } from '@/components/app/bottom-tabs';
import { DISPLAY_MODE_OVERRIDE_KEY, isStandaloneDisplay } from '@/components/pwa/display-mode';
import { InstallCard, installCardVariant } from '@/components/pwa/install-card';
import { installPlatform } from '@/components/pwa/platform';
import { NotifyChoicePanel, pushAvailability } from '@/components/notify/notify-choice-panel';
import { NotifyChoice } from '@/components/notify/notify-choice';

/**
 * docs/PLATFORM-2.0.md §5.2–§5.3 — the installed app's chrome. The bottom tabs exist only in
 * standalone mode (2026-10-07: no bottom-fixed UI in the mobile browser), the install card shows
 * once per platform it can help on, and the push choice says what it can do on this device.
 */

const ko = getDictionary('ko');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_KAKAO = `${IPHONE} KAKAOTALK 10.8.5`;
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const media = (matches: boolean) => () => ({ matches });

describe('standalone detection', () => {
  it('is the display-mode query, or iOS’s navigator.standalone', () => {
    expect(isStandaloneDisplay({ matchMedia: media(true) })).toBe(true);
    expect(isStandaloneDisplay({ matchMedia: media(false), navigator: { standalone: true } })).toBe(true);
    expect(isStandaloneDisplay({ matchMedia: media(false), navigator: { standalone: false } })).toBe(false);
    expect(isStandaloneDisplay({})).toBe(false);
  });

  it('honours the documented QA flag and survives storage that throws', () => {
    const flag = { getItem: (key: string) => (key === DISPLAY_MODE_OVERRIDE_KEY ? 'standalone' : null) };
    expect(isStandaloneDisplay({ matchMedia: media(false), storage: flag })).toBe(true);
    const blocked = { getItem: () => { throw new Error('SecurityError'); } };
    expect(isStandaloneDisplay({ matchMedia: media(false), storage: blocked })).toBe(false);
  });
});

describe('bottom tabs (standalone only)', () => {
  const labels = ko.appShell.tabs;

  it('never renders on the server or in a browser tab', () => {
    expect(renderToStaticMarkup(<BottomTabs locale="ko" labels={labels} />)).toBe('');
  });

  it('is three tabs while "내 사진" and "계정" are the same place', () => {
    const items = bottomTabItems({ locale: 'ko', pathname: '/ko/video', signedIn: true, labels });
    expect(items.map((t) => [t.id, t.href])).toEqual([
      ['formats', '/ko/video'],
      ['renders', '/renders'],
      ['account', '/account'],
    ]);
  });

  it('grows the fourth tab the day the photo page has its own address', () => {
    const items = bottomTabItems({ locale: 'en', pathname: '/identity/selfie', signedIn: true, labels, photoHref: '/identity/selfie' });
    expect(items.map((t) => t.id)).toEqual(['formats', 'renders', 'photo', 'account']);
    expect(items.find((t) => t.id === 'photo')).toMatchObject({ href: '/identity/selfie', current: true });
  });

  it('sends a signed-out reader’s "내 작품" to the sign-in door, coming back to their work', () => {
    const renders = bottomTabItems({ locale: 'ko', pathname: '/ko', signedIn: false, labels }).find((t) => t.id === 'renders')!;
    expect(renders.href).toBe('/auth/choose?next=%2Frenders&locale=ko');
  });

  it('marks exactly the current section', () => {
    const at = (pathname: string) => bottomTabItems({ locale: 'ko', pathname, signedIn: true, labels }).filter((t) => t.current).map((t) => t.id);
    expect(at('/ko/video')).toEqual(['formats']);
    expect(at('/ko/image')).toEqual(['formats']);
    expect(at('/ko/t/neon-alley-dolly')).toEqual(['formats']);
    expect(at('/renders/abc')).toEqual(['renders']);
    expect(at('/account')).toEqual(['account']);
    expect(at('/ko/campaigns')).toEqual([]);
  });

  it('renders 44px+ targets with aria-current and a visible focus ring, in the dark brand tokens', () => {
    const items = bottomTabItems({ locale: 'ko', pathname: '/renders', signedIn: true, labels });
    const html = renderToStaticMarkup(<BottomTabsBar items={items} label={labels.nav} />);
    expect(html).toContain('data-bottom-tabs');
    expect(html).toContain(`aria-label="${labels.nav}"`);
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="\/renders"[^>]*aria-current="page"/);
    expect(html).toContain('min-h-14');
    expect(html).toContain('focus-visible:outline-app-gold');
    expect(html).toContain('bg-app-bg');
    expect(html).not.toMatch(/bg-white|text-black|bg-blue/);
    for (const label of [labels.formats, labels.renders, labels.account]) expect(html).toContain(label);
  });

  it('is hidden by CSS outside standalone and wherever a page declares data-hide-tabs', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\[data-bottom-tabs\]\s*\{\s*display:\s*none;?\s*\}/);
    expect(css).toMatch(/@media \(display-mode: standalone\)\s*\{\s*\[data-bottom-tabs\]\s*\{\s*display:\s*block;?\s*\}/);
    expect(css).toMatch(/body:has\(\[data-hide-tabs\]\) \[data-bottom-tabs\]\s*\{\s*display:\s*none;?\s*\}/);
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('env(safe-area-inset-top');
  });
});

describe('install card (once, and only where it can help)', () => {
  it('tells the platforms apart from the user agent', () => {
    expect(installPlatform({ userAgent: IPHONE })).toBe('ios-safari');
    expect(installPlatform({ userAgent: IPHONE_KAKAO })).toBe('other');
    expect(installPlatform({ userAgent: IPHONE_CHROME })).toBe('other');
    expect(installPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios-safari');
    expect(installPlatform({ userAgent: ANDROID })).toBe('android');
    expect(installPlatform({ userAgent: DESKTOP })).toBe('other');
  });

  it('offers the saved Android prompt, or the iOS share-sheet steps, and nothing else', () => {
    const base = { standalone: false, dismissed: false, hasPrompt: false } as const;
    expect(installCardVariant({ ...base, platform: 'android', hasPrompt: true })).toBe('android');
    expect(installCardVariant({ ...base, platform: 'android' })).toBeNull();
    expect(installCardVariant({ ...base, platform: 'ios-safari' })).toBe('ios');
    expect(installCardVariant({ ...base, platform: 'other', hasPrompt: true })).toBeNull();
    // /account walks an iPhone through the home screen in the push choice itself.
    expect(installCardVariant({ ...base, platform: 'ios-safari', allowed: ['android'] })).toBeNull();
    expect(installCardVariant({ ...base, platform: 'android', hasPrompt: true, allowed: ['android'] })).toBe('android');
  });

  it('stays away in the installed app, after "다시 보지 않기", and before the page knows', () => {
    expect(installCardVariant({ standalone: true, dismissed: false, hasPrompt: true, platform: 'android' })).toBeNull();
    expect(installCardVariant({ standalone: false, dismissed: true, hasPrompt: true, platform: 'android' })).toBeNull();
    expect(installCardVariant({ standalone: null, dismissed: false, hasPrompt: false, platform: 'ios-safari' })).toBeNull();
    expect(installCardVariant({ standalone: false, dismissed: false, hasPrompt: false, platform: null })).toBeNull();
    // Already receiving the completion push in this browser: the card's promise is kept.
    expect(installCardVariant({ standalone: false, dismissed: false, hasPrompt: true, platform: 'android', alerting: true })).toBeNull();
    expect(renderToStaticMarkup(<InstallCard copy={ko.appShell.install} />)).toBe('');
  });
});

describe('notify choice', () => {
  afterEach(() => vi.unstubAllEnvs());
  const ready = { publicKey: 'key', supported: true, ios: false, standalone: false, permission: 'default' as const };

  it('says what push can do on this device', () => {
    expect(pushAvailability(ready)).toBe('ready');
    expect(pushAvailability({ ...ready, publicKey: null })).toBe('unconfigured');
    expect(pushAvailability({ ...ready, supported: false })).toBe('unsupported');
    expect(pushAvailability({ ...ready, permission: 'denied' })).toBe('denied');
    // iPhone in a Safari tab: push only exists once TWINGS is on the home screen.
    expect(pushAvailability({ ...ready, ios: true, supported: false })).toBe('install');
    expect(pushAvailability({ ...ready, ios: true, standalone: true })).toBe('ready');
  });

  it('shows "unavailable" straight from the server when this deployment has no keys', () => {
    const html = renderToStaticMarkup(<NotifyChoicePanel copy={ko.appShell.notify} iosHelp={ko.appShell.install.iosBody} publicKey={null} mode="ask" />);
    expect(html).toContain('data-notify-choice="unconfigured"');
    expect(html).toContain(ko.appShell.notify.title);
    expect(html).toContain(ko.appShell.notify.unavailable);
    expect(html).toContain(ko.appShell.notify.emailAlways);
    expect(html).not.toContain(ko.appShell.notify.enable);
  });

  it('asks while the render is waiting, offers the install card once it is done, and stays quiet on failure', () => {
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', '');
    for (const status of ['queued', 'running', 'held'] as const) {
      expect(renderToStaticMarkup(<NotifyChoice dict={ko} context="render" status={status} />), status).toContain('data-notify-choice');
    }
    expect(renderToStaticMarkup(<NotifyChoice dict={ko} context="render" status="succeeded" />)).not.toContain('data-notify-choice');
    expect(renderToStaticMarkup(<NotifyChoice dict={ko} context="render" status="failed" />)).toBe('');
  });

  it('is a setting on /account, handing the browser the public key only', () => {
    const keys = webPush.generateVAPIDKeys();
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', keys.publicKey);
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', keys.privateKey);
    vi.stubEnv('WEB_PUSH_SUBJECT', 'mailto:hello@twings.app');
    const html = renderToStaticMarkup(<NotifyChoice dict={ko} context="account" />);
    expect(html).toContain('data-notify-choice="checking"');
    expect(html).toContain(ko.appShell.notify.settingsTitle);
    expect(html).not.toContain(keys.privateKey);
  });
});
