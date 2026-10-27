import { useEffect, useState } from 'react';
import { storeClientHeaderValue } from '@/lib/mobile/store-bridge';
import { DISPLAY_MODE_OVERRIDE_KEY } from './shell';

export { DISPLAY_MODE_OVERRIDE_KEY };

/**
 * "Is this the installed app?" — docs/PLATFORM-2.0.md §5.2. The bottom tabs, the install card and
 * the push choice all ask it, and the answer is never guessed on the server: a static marketing
 * page cannot know, so the hook answers null until the page has looked.
 */

export interface DisplayEnv {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
  storage?: { getItem(key: string): string | null } | null;
  /** A store binary (`<html data-store>`, lib/mobile/store-bridge.ts) — a Capacitor web view is
   * the installed app even though its display-mode query answers "browser". */
  store?: boolean;
}

/** The display-mode query, iOS's legacy `navigator.standalone`, a store binary, or the documented QA flag. */
export function isStandaloneDisplay(env: DisplayEnv): boolean {
  if (env.store) return true;
  try {
    if (env.storage?.getItem(DISPLAY_MODE_OVERRIDE_KEY) === 'standalone') return true;
  } catch {
    // Storage blocked (private mode, site data off) is not a reason to guess either way.
  }
  if (env.navigator?.standalone === true) return true;
  try {
    return env.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

export function browserDisplayEnv(): DisplayEnv {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    matchMedia: typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query) : undefined,
    navigator: window.navigator as Navigator & { standalone?: boolean },
    storage,
    store: storeClientHeaderValue(document.documentElement) !== null,
  };
}

/**
 * null until mounted, then which store binary this page runs in (`'ios-store' | 'android-store'`),
 * or false in a browser tab or an installed PWA — those pay on the web as usual.
 */
export function useStoreClient(): string | false | null {
  const [store, setStore] = useState<string | false | null>(null);
  useEffect(() => {
    setStore(storeClientHeaderValue(document.documentElement) ?? false);
  }, []);
  return store;
}

/**
 * null until mounted, then whether this is the installed app. Mirrors the answer onto
 * `<html data-standalone>`, which app/globals.css reads for what the display-mode query cannot see
 * (iOS's legacy flag, the QA flag).
 */
export function useStandaloneDisplay(): boolean | null {
  const [standalone, setStandalone] = useState<boolean | null>(null);
  useEffect(() => {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
    const read = () => {
      const value = isStandaloneDisplay(browserDisplayEnv());
      document.documentElement.toggleAttribute('data-standalone', value);
      setStandalone(value);
    };
    read();
    query?.addEventListener?.('change', read);
    return () => query?.removeEventListener?.('change', read);
  }, []);
  return standalone;
}
