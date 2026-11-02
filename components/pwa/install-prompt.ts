import { useSyncExternalStore } from 'react';

/**
 * Chrome's install prompt, held until our card asks for it (docs/PLATFORM-2.0.md §5.2).
 *
 * `beforeinstallprompt` fires once per page load, usually before the card that wants it has
 * mounted, so RegisterServiceWorker (in both root layouts) captures it on every page and the card
 * reads it from here. `preventDefault()` keeps Chrome's own mini-infobar out of the way: the
 * suggestion comes once, from us, after the first result.
 */

/** Not in lib.dom: Chromium only. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let capturing = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function captureInstallPrompt(target: Window = window): void {
  if (capturing) return;
  capturing = true;
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

/** Spends the saved prompt — Chrome refuses a second `prompt()` on the same event. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (event === null) return 'unavailable';
  deferred = null;
  emit();
  await event.prompt();
  return (await event.userChoice).outcome;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a saved prompt is waiting. Always false on the server. */
export function useInstallPrompt(): boolean {
  return useSyncExternalStore(subscribe, () => deferred !== null, () => false);
}
