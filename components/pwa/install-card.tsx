'use client';

import { useEffect, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { useStandaloneDisplay } from './display-mode';
import { promptInstall, useInstallPrompt } from './install-prompt';
import { installPlatform, type InstallPlatform } from './platform';
import { INSTALL_CARD_DISMISSED_KEY, PUSH_ON_EVENT } from './shell';

/**
 * "홈 화면에 추가하면 완성 알림을 받을 수 있어요" — docs/PLATFORM-2.0.md §5.2. One card, on /account
 * and on a finished result: Android gets Chrome's saved prompt behind a button, Safari on iOS gets
 * the share-sheet steps (iOS 16.4+ pushes only to a home-screen app). Never in the installed app,
 * never where installing is not possible, never where this browser already receives the completion
 * push (the card's promise is already kept), and never again after "다시 보지 않기" — or after the
 * reader turned Chrome's own dialog down.
 */

export type InstallCardVariant = 'android' | 'ios';

const ALL_VARIANTS: InstallCardVariant[] = ['android', 'ios'];

export function installCardVariant(state: {
  standalone: boolean | null;
  dismissed: boolean;
  hasPrompt: boolean;
  platform: InstallPlatform | null;
  allowed?: InstallCardVariant[];
  /** This browser already holds a granted push subscription. */
  alerting?: boolean;
}): InstallCardVariant | null {
  // null = the page has not looked yet; the server never shows the card.
  if (state.standalone !== false || state.dismissed || state.platform === null || state.alerting) return null;
  const variant = state.platform === 'ios-safari' ? 'ios' : state.platform === 'android' && state.hasPrompt ? 'android' : null;
  return variant !== null && (state.allowed ?? ALL_VARIANTS).includes(variant) ? variant : null;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_CARD_DISMISSED_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

/** Granted and subscribed: this browser already hears when a render is done. */
async function alreadyAlerting(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker.getRegistration('/');
    return (await registration?.pushManager?.getSubscription()) != null;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_CARD_DISMISSED_KEY, 'dismissed');
  } catch {
    // Storage off: the card goes for this page, and may come back next time. Nothing breaks.
  }
}

/** `allowed` narrows the platforms, for a page that already explains the iOS route itself. */
export function InstallCard({ copy, allowed }: { copy: Dictionary['appShell']['install']; allowed?: InstallCardVariant[] }) {
  const standalone = useStandaloneDisplay();
  const hasPrompt = useInstallPrompt();
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [alerting, setAlerting] = useState(false);

  useEffect(() => {
    let live = true;
    setDismissed(readDismissed());
    // Decide before showing anything, so a reader who already gets the push never sees the card flash.
    void alreadyAlerting().then((value) => {
      if (!live) return;
      setAlerting(value);
      setPlatform(installPlatform({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }));
    });
    const pushOn = () => setAlerting(true);
    window.addEventListener(PUSH_ON_EVENT, pushOn);
    return () => {
      live = false;
      window.removeEventListener(PUSH_ON_EVENT, pushOn);
    };
  }, []);

  const variant = installCardVariant({ standalone, dismissed, hasPrompt, platform, allowed, alerting });
  if (variant === null) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };
  const install = async () => {
    const outcome = await promptInstall();
    // Installed, or declined in Chrome's own dialog: either way the suggestion has been made once.
    if (outcome !== 'unavailable') dismiss();
  };

  return (
    <aside data-install-card={variant} aria-label={copy.title} className="mt-8 max-w-detail border border-hairline p-5 sm:p-6">
      <p className="text-[1.0625rem] leading-snug font-semibold">{copy.title}</p>
      <p className="mt-2 text-[0.9375rem] opacity-70">{variant === 'ios' ? copy.iosBody : copy.androidBody}</p>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        {variant === 'android' && (
          <button type="button" onClick={install} className="inline-flex min-h-11 items-center bg-accent px-5 font-label text-label text-white uppercase">
            {copy.androidAction}
          </button>
        )}
        <button type="button" onClick={dismiss} data-install-dismiss className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 opacity-70">
          {copy.dismiss}
        </button>
      </div>
    </aside>
  );
}
