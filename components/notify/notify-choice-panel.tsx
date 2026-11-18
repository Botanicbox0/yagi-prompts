'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { browserDisplayEnv, isStandaloneDisplay } from '@/components/pwa/display-mode';
import { isIosDevice } from '@/components/pwa/platform';
import { PUSH_ON_EVENT } from '@/components/pwa/shell';
import { currentPushSubscription, pushAvailability, pushSupported, savePush, subscribePush, unsubscribePush, type PushAvailability } from './push-client';

/**
 * "완성되면 알려드릴까요?" — the push half of docs/PLATFORM-2.0.md §5.3, as a button the reader
 * presses. Permission is asked only inside that press (Safari refuses otherwise, and an unasked
 * prompt is how sites lose the permission for good). An iPhone in a Safari tab is pointed at the
 * home screen first: iOS pushes only to an installed web app. Email is always sent either way.
 */

type Copy = Dictionary['appShell']['notify'];

export { pushAvailability, type PushAvailability } from './push-client';

type PanelState = 'checking' | Exclude<PushAvailability, 'ready'> | 'off' | 'busy' | 'on' | 'error';

/** The completion push's own door (the brand host's room notices use theirs, components/notify/push-client.ts). */
const PUSH_ENDPOINT = '/api/notify/push';

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
        const subscription = await currentPushSubscription(publicKey);
        if (cancelled) return;
        if (subscription) {
          setState('on');
          // Keep the server's record in step with this device, and with whoever is signed in now.
          void savePush(PUSH_ENDPOINT, 'POST', subscription.toJSON()).catch(() => undefined);
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
      // Permission inside this press, then the worker, the subscription and the server.
      const result = await subscribePush(publicKey, PUSH_ENDPOINT);
      if (result !== 'on') {
        setState(result);
        return;
      }
      setState('on');
      window.dispatchEvent(new Event(PUSH_ON_EVENT));
    } catch {
      setState('error');
    }
  };

  const disable = async () => {
    setState('busy');
    try {
      await unsubscribePush(PUSH_ENDPOINT);
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
