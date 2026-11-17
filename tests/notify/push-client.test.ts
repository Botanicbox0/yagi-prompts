import webPush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribePush } from '@/components/notify/push-client';

/**
 * The shared browser push flow (components/notify/push-client.ts), used by the completion-push choice on
 * twings.app and the room notice settings on the brand host. When the server refuses to store a new
 * subscription, the browser's subscription is undone too, so neither screen shows push on after a reload
 * while the server has no row (docs/BRAND-ROOMS-FEEDBACK.md §10, browser check 2026-11-18). The browser is
 * faked at its edges: permission, the worker registration, the push manager and fetch.
 */
const KEY = webPush.generateVAPIDKeys().publicKey;

function fakeBrowser(save: () => Promise<Response>, options: { unsubscribe?: () => Promise<boolean> } = {}) {
  const unsubscribe = vi.fn(options.unsubscribe ?? (async () => true));
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/this-browser',
    options: { applicationServerKey: Uint8Array.from(Buffer.from(KEY, 'base64url')).buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/this-browser', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe,
  };
  const subscribe = vi.fn(async () => subscription);
  const registration = { pushManager: { getSubscription: async () => null, subscribe } };
  const fetch = vi.fn(save);
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => 'granted' });
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => registration), ready: Promise.resolve(registration), getRegistration: async () => registration } });
  vi.stubGlobal('fetch', fetch);
  return { unsubscribe, subscribe, fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscribePush', () => {
  it('keeps the new subscription when the server stores it', async () => {
    const browser = fakeBrowser(async () => new Response('{"ok":true}', { status: 200 }));
    await expect(subscribePush(KEY, '/api/brand-rooms/notice-push?organizationId=x')).resolves.toBe('on');
    expect(browser.fetch).toHaveBeenCalledWith('/api/brand-rooms/notice-push?organizationId=x', expect.objectContaining({ method: 'POST' }));
    expect(browser.unsubscribe).not.toHaveBeenCalled();
  });

  it.each([400, 403, 404, 500, 503])('undoes the browser subscription when the server answers %i, then fails', async (status) => {
    const browser = fakeBrowser(async () => new Response('{"ok":false}', { status }));
    await expect(subscribePush(KEY, '/api/notify/push')).rejects.toThrow(`push subscription refused: ${status}`);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still reports the refusal when undoing the browser subscription fails too', async () => {
    const browser = fakeBrowser(async () => new Response('', { status: 503 }), { unsubscribe: async () => Promise.reject(new Error('gone')) });
    await expect(subscribePush(KEY, '/api/notify/push')).rejects.toThrow('push subscription refused: 503');
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the subscription when the save never got an answer, so the next visit can send it again', async () => {
    const browser = fakeBrowser(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(subscribePush(KEY, '/api/notify/push')).rejects.toThrow('Failed to fetch');
    expect(browser.unsubscribe).not.toHaveBeenCalled();
  });

  it('asks nothing of the server when the person refuses or dismisses the permission', async () => {
    for (const answer of ['denied', 'default'] as const) {
      const browser = fakeBrowser(async () => new Response('', { status: 200 }));
      vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => answer });
      await expect(subscribePush(KEY, '/api/notify/push')).resolves.toBe(answer === 'denied' ? 'denied' : 'off');
      expect(browser.subscribe).not.toHaveBeenCalled();
      expect(browser.fetch).not.toHaveBeenCalled();
    }
  });
});
