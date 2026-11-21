'use client';

import { composeStorageKey } from '@/lib/brand-studio/compose/timeline';

/**
 * Where the organization's film lives while V1 runs: this browser, under the same key the current
 * editor uses (docs/BRAND-EDITING-STUDIO-V2.md §11: the current editor stays until V8 and both share the
 * key until the server project in V3). The sound studio writes the same key.
 *
 * Browser storage can be missing, full or blocked, so every access is guarded: the editor then keeps
 * the film in memory for this visit and says so once. Only this file and the shortcut store touch
 * browser storage (tests/brand-studio/editor-v2/flag-gate.test.ts).
 */
export type FilmRead = { ok: true; text: string | null } | { ok: false };

export function readFilmText(organizationId: string): FilmRead {
  try {
    return { ok: true, text: window.localStorage.getItem(composeStorageKey(organizationId)) };
  } catch {
    return { ok: false };
  }
}

export function writeFilmText(organizationId: string, text: string): boolean {
  try {
    window.localStorage.setItem(composeStorageKey(organizationId), text);
    return true;
  } catch {
    return false;
  }
}

/** Calls `onChange` with the new text when another tab writes this organization's film. */
export function watchFilmText(organizationId: string, onChange: (text: string | null) => void): () => void {
  const key = composeStorageKey(organizationId);
  const listener = (event: StorageEvent) => {
    try {
      if (event.key !== key || event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    onChange(event.newValue);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
