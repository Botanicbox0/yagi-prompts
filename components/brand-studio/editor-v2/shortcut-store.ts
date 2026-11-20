'use client';

import { DEFAULT_SHORTCUT_PREFS, parseShortcutPrefs, type ShortcutPrefs } from '@/lib/brand-studio/editor-v2/shortcuts';

/**
 * Where a person's shortcut keys are kept: this browser. The workspace has no per-member preference
 * store yet (the rail's own order lives in the browser too, components/brand-workspace/navigation.tsx),
 * and the prototype writes nothing to the server. The rebuild moves this to a member preference so the
 * keys follow the person across browsers (docs/BRAND-EDITING-STUDIO-V2.md §5.1).
 *
 * Storage can be missing, full or blocked, so every access is guarded and the editor works without it.
 */
const KEY = 'twings_editor_shortcuts_v1';

export function loadShortcutPrefs(): ShortcutPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? parseShortcutPrefs(JSON.parse(raw)) : DEFAULT_SHORTCUT_PREFS;
  } catch {
    return DEFAULT_SHORTCUT_PREFS;
  }
}

export function saveShortcutPrefs(prefs: ShortcutPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Nothing to do: the keys stay in force for this visit.
  }
}
