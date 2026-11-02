import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * docs/PLATFORM-2.0.md §5.2 — `public/sw.js` gains `push` and `notificationclick` and keeps the
 * navigation contract (network first, offline page only). The worker runs here in a VM with a fake
 * `self`, so what is asserted is what the browser would execute, not a string search.
 */

const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://twings.app';

type Handler = (event: Record<string, unknown>) => void;

interface FakeClient { url: string; focused: boolean; navigatedTo: string | null; focus(): Promise<FakeClient>; navigate(url: string): Promise<FakeClient> }

function client(url: string): FakeClient {
  const c: FakeClient = {
    url,
    focused: false,
    navigatedTo: null,
    async focus() { c.focused = true; return c; },
    async navigate(next: string) { c.navigatedTo = next; c.url = next; return c; },
  };
  return c;
}

function boot(windows: FakeClient[] = [], caches: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(async () => undefined),
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); }),
    },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => { opened.push(url); return client(url); }),
    },
  };
  runInNewContext(SOURCE, { self, caches, fetch: vi.fn(), URL, JSON, Promise, console });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const waits: Array<Promise<unknown>> = [];
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no ${type} handler`);
    handler({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { handlers, shown, opened, dispatch, self };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload) } });
const clickEvent = (data: unknown) => {
  const notification = { data, close: vi.fn() };
  return { notification };
};

describe('public/sw.js (docs/PLATFORM-2.0.md §5.2)', () => {
  it('keeps the navigation contract and adds the two push handlers', () => {
    const { handlers } = boot();
    expect([...handlers.keys()].sort()).toEqual(['activate', 'fetch', 'install', 'notificationclick', 'push']);
    expect(SOURCE).toContain("self.addEventListener('push'");
    expect(SOURCE).toContain("self.addEventListener('notificationclick'");
  });

  it('shows the message the server sent, tagged so a resend replaces instead of stacking', async () => {
    const sw = boot();
    await sw.dispatch('push', pushEvent({ title: '완성됐어요', body: '쇼츠 결과물이 준비됐어요.', url: '/renders/abc', tag: 'render-abc', lang: 'ko' }));
    expect(sw.shown).toHaveLength(1);
    const [{ title, options }] = sw.shown as [{ title: string; options: Record<string, unknown> }];
    expect(title).toBe('완성됐어요');
    expect(options.body).toBe('쇼츠 결과물이 준비됐어요.');
    expect(options.tag).toBe('render-abc');
    expect(options.lang).toBe('ko');
    expect(options.icon).toBe('/icons/icon-192.png');
    expect(options.badge).toBe('/icons/badge-96.png');
    expect(options.data).toEqual({ url: `${ORIGIN}/renders/abc` });
  });

  it('still shows something for an empty or broken payload, pointing at my work', async () => {
    const sw = boot();
    await sw.dispatch('push', { data: { json: () => { throw new SyntaxError('bad'); } } });
    await sw.dispatch('push', { data: null });
    expect(sw.shown.map((s) => s.title)).toEqual(['TWINGS', 'TWINGS']);
    expect(sw.shown.every((s) => (s.options.data as { url: string }).url === `${ORIGIN}/renders`)).toBe(true);
  });

  it('never carries a link off the site', async () => {
    const sw = boot();
    await sw.dispatch('push', pushEvent({ title: 'x', url: 'https://evil.example/phish' }));
    await sw.dispatch('push', pushEvent({ title: 'y', url: 'javascript:alert(1)' }));
    expect(sw.shown.map((s) => (s.options.data as { url: string }).url)).toEqual([`${ORIGIN}/renders`, `${ORIGIN}/renders`]);
  });

  it('focuses a window already on the linked page', async () => {
    const already = client(`${ORIGIN}/renders/abc`);
    const sw = boot([client(`${ORIGIN}/ko/video`), already]);
    const event = clickEvent({ url: `${ORIGIN}/renders/abc` });
    await sw.dispatch('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(already.focused).toBe(true);
    expect(sw.opened).toEqual([]);
  });

  it('brings an open window of the app to the linked page', async () => {
    const open = client(`${ORIGIN}/ko/video`);
    const sw = boot([open]);
    await sw.dispatch('notificationclick', clickEvent({ url: `${ORIGIN}/renders/abc` }));
    expect(open.focused).toBe(true);
    expect(open.navigatedTo).toBe(`${ORIGIN}/renders/abc`);
    expect(sw.opened).toEqual([]);
  });

  it('opens the link when no window is open, and refuses foreign links', async () => {
    const sw = boot([]);
    await sw.dispatch('notificationclick', clickEvent({ url: `${ORIGIN}/renders/abc` }));
    await sw.dispatch('notificationclick', clickEvent({ url: 'https://evil.example/x' }));
    expect(sw.opened).toEqual([`${ORIGIN}/renders/abc`, `${ORIGIN}/renders`]);
  });

  it('falls back to opening a window when the open one cannot be navigated', async () => {
    const stubborn = client(`${ORIGIN}/ko/video`);
    stubborn.navigate = async () => { throw new TypeError('not controlled'); };
    const sw = boot([stubborn]);
    await sw.dispatch('notificationclick', clickEvent({ url: `${ORIGIN}/renders/abc` }));
    expect(sw.opened).toEqual([`${ORIGIN}/renders/abc`]);
  });

  it('installs even when the offline page cannot be stored, so push never depends on it', async () => {
    const stored: string[] = [];
    const sw = boot([], { open: async () => ({ add: async (url: string) => { stored.push(url); } }) });
    await sw.dispatch('install', {});
    expect(stored).toEqual(['/offline.html']);
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);

    const broken = boot([], { open: async () => { throw new Error('UnknownError: Unexpected internal error.'); } });
    await broken.dispatch('install', {});
    expect(broken.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('still answers navigations network first and caches nothing but the offline page', () => {
    expect(SOURCE).toContain("const OFFLINE_URL = '/offline.html'");
    expect(SOURCE).toContain("if (request.mode !== 'navigate') return;");
    expect(SOURCE).not.toMatch(/cache\.put\(/);
  });
});
