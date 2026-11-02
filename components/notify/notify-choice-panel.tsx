'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { browserDisplayEnv, isStandaloneDisplay } from '@/components/pwa/display-mode';
import { isIosDevice } from '@/components/pwa/platform';
import { PUSH_ON_EVENT } from '@/components/pwa/shell';

/**
 * "완성되면 알려드릴까요?" — the push half of docs/PLATFORM-2.0.md §5.3, as a button the reader
 * presses. Permission is asked only inside that press (Safari refuses otherwise, and an unasked
 * prompt is how sites lose the permission for good). An iPhone in a Safari tab is pointed at the
 * home screen first: iOS pushes only to an installed web app. Email is always sent either way.
 */

type Copy = Dictionary['appShell']['notify'];

export type PushAvailability = 'unconfigured' | 'install' | 'unsupported' | 'denied' | 'ready';

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

type PanelState = 'checking' | Exclude<PushAvailability, 'ready'> | 'off' | 'busy' | 'on' | 'error';

/** `pushManager.subscribe` takes the VAPID public key as bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (current === null) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, i) => byte === expected[i]);
}

/** A worker that never activates, or a push service that never answers, must not hold the button. */
function within<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function save(method: 'POST' | 'DELETE', body: unknown): Promise<Response> {
  return fetch('/api/notify/push', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

export function NotifyChoicePanel({ copy, iosHelp, publicKey, mode }: { copy: Copy; iosHelp: string; publicKey: string | null; mode: 'ask' | 'settings' }) {
  // No keys on this deployment is known on the server: say so in the first paint, no flash.
  const [state, setState] = useState<PanelState>(publicKey === null ? 'unconfigured' : 'checking');
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    if (publicKey === null) return;
    let cancelled = false;
    const availability = pushAvailability({
      publicKey,
      supported: pushSupported(),
      ios: isIosDevice({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
      standalone: isStandaloneDisplay(browserDisplayEnv()),
      permission: 'Notification' in window ? Notification.permission : null,
    });
    if (availability !== 'ready') {
      setState(availability);
      return;
    }
    void (async () => {
      try {
        const subscription = Notification.permission === 'granted' ? await existingSubscription() : null;
        if (cancelled) return;
        if (subscription && sameKey(subscription.options.applicationServerKey, keyBytes(publicKey))) {
          setState('on');
          // Keep the server's record in step with this device, and with whoever is signed in now.
          void save('POST', subscription.toJSON()).catch(() => undefined);
        } else {
          setState('off');
        }
      } catch {
        if (!cancelled) setState('off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const enable = async () => {
    if (publicKey === null) return;
    setState('busy');
    try {
      // First thing inside the press: Safari grants permission only to a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
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
      const response = await save('POST', subscription.toJSON());
      if (!response.ok) throw new Error(`push subscription refused: ${response.status}`);
      setState('on');
      window.dispatchEvent(new Event(PUSH_ON_EVENT));
    } catch {
      setState('error');
    }
  };

  const disable = async () => {
    setState('busy');
    try {
      const subscription = await existingSubscription();
      if (subscription) {
        await save('DELETE', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState('off');
    } catch {
      setState('error');
    }
  };

  // The site's own button: `px-6 py-3 font-label text-label uppercase`, filled accent or outlined.
  const button = 'inline-flex min-h-11 items-center px-6 py-3 font-label text-label uppercase';
  return (
    <section
      data-notify-choice={state}
      aria-label={mode === 'ask' ? copy.title : copy.settingsTitle}
      className={mode === 'ask' ? 'mt-10 max-w-detail border border-hairline p-5 sm:p-6' : 'mt-10 max-w-detail border-t border-hairline pt-6'}
    >
      {mode === 'ask' ? (
        <>
          <p className="text-[1.0625rem] leading-snug font-semibold">{copy.title}</p>
          <p className="mt-2 text-[0.9375rem] opacity-70">{copy.lede}</p>
        </>
      ) : (
        <p className="text-body font-medium">{copy.settingsTitle}</p>
      )}

      <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        {(state === 'off' || state === 'error') && (
          <button type="button" onClick={enable} data-notify-enable className={`${button} bg-accent text-white`}>
            {copy.enable}
          </button>
        )}
        {state === 'busy' && (
          <button type="button" disabled aria-busy="true" className={`${button} bg-accent text-white opacity-60`}>
            {copy.busy}
          </button>
        )}
        {state === 'on' && (
          <>
            <p data-notify-on className="text-[0.9375rem]">{copy.on}</p>
            <button type="button" onClick={disable} data-notify-disable className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
              {copy.disable}
            </button>
          </>
        )}
        {(state === 'unconfigured' || state === 'unsupported') && <p className="text-[0.9375rem] opacity-70">{copy.unavailable}</p>}
        {state === 'install' && (
          <>
            <p className="text-[0.9375rem] opacity-70">{copy.install}</p>
            {!guide && (
              <button type="button" onClick={() => setGuide(true)} data-notify-install className={`${button} border border-current`}>
                {copy.installAction}
              </button>
            )}
          </>
        )}
        {state === 'denied' && <p role="alert" className="text-[0.9375rem] text-accent">{copy.denied}</p>}
      </div>

      {state === 'install' && guide && <p data-notify-install-guide className="mt-4 border-l-2 border-accent pl-3 text-[0.9375rem]">{iosHelp}</p>}
      {state === 'error' && <p role="alert" className="mt-3 text-sm text-accent">{copy.error}</p>}
      <p className="mt-4 font-mono text-[0.75rem] opacity-70">{copy.emailAlways}</p>
    </section>
  );
}
