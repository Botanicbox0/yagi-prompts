/**
 * This browser's push subscription, in the browser (docs/PLATFORM-2.0.md §5.3). One flow, two doors:
 * the completion-push choice on twings.app (`/api/notify/push`, components/notify/notify-choice-panel.tsx)
 * and the room notice settings on the brand host (`/api/brand-rooms/notice-push`,
 * components/brand-rooms/chat/notice-settings.tsx). Client code only: never import lib/notify/push.ts here.
 *
 * Permission is asked only inside a press (`subscribePush`): Safari refuses otherwise, and an unasked
 * prompt is how sites lose the permission for good.
 */

export type PushAvailability = 'unconfigured' | 'install' | 'unsupported' | 'denied' | 'ready';

/** What push can do in this browser, before anything is asked. An iPhone in a Safari tab has to install first. */
export function pushAvailability(env: {
  publicKey: string | null;
  supported: boolean;
  ios: boolean;
  standalone: boolean;
  permission: NotificationPermission | null;
}): PushAvailability {
  if (env.publicKey === null) return 'unconfigured';
  if (env.ios && !env.standalone) return 'install';
  if (!env.supported) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'ready';
}

/** `pushManager.subscribe` takes the VAPID public key as bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (current === null) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
}

/** A worker that never activates, or a push service that never answers, must not hold the button. */
export function within<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function savePush(endpoint: string, method: 'POST' | 'DELETE', body: unknown): Promise<Response> {
  return fetch(endpoint, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

/** The subscription this browser already holds with this key, when permission is granted; else null. */
export async function currentPushSubscription(publicKey: string): Promise<PushSubscription | null> {
  const subscription = Notification.permission === 'granted' ? await existingSubscription() : null;
  return subscription && sameKey(subscription.options.applicationServerKey, keyBytes(publicKey)) ? subscription : null;
}

/**
 * Inside a press: permission first, then the worker, a subscription with this key (an older key's is
 * replaced), then the server at `endpoint`. `denied` / `off` when permission was refused or dismissed;
 * throws when anything after the permission fails.
 *
 * When the server refuses to store the subscription (any non-2xx), the browser's subscription is undone
 * as well (best effort), so a reload does not show push on while the server has no row for it. A save
 * that never got an answer (network) keeps it: the next visit sends it again and the two agree.
 */
export async function subscribePush(publicKey: string, endpoint: string): Promise<'on' | 'denied' | 'off'> {
  // First thing inside the press: Safari grants permission only to a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  // Idempotent: the same script and scope hand back the registration the layout made.
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const registration = await within(navigator.serviceWorker.ready);
  const key = keyBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with an older key cannot be reached with this one: replace it.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await within(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  const response = await savePush(endpoint, 'POST', subscription.toJSON());
  if (!response.ok) {
    try {
      await subscription.unsubscribe();
    } catch {
      // Best effort: the refusal is what the caller reports.
    }
    throw new Error(`push subscription refused: ${response.status}`);
  }
  return 'on';
}

/** This browser says no: the server row first, then the browser's own subscription. */
export async function unsubscribePush(endpoint: string): Promise<void> {
  const subscription = await existingSubscription();
  if (subscription) {
    await savePush(endpoint, 'DELETE', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
}
