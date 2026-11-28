'use client';

import { DEFAULT_SHORTCUT_PREFS, parseShortcutPrefs, type ShortcutPrefs } from '@/lib/brand-studio/editor-v2/shortcuts';
import { p10DefaultTrackToggles, parseTracksPrefs, type TracksPrefs } from '@/lib/brand-studio/editor-v2/tracks';

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

/**
 * Per-browser parallel-tracks toolbar preferences (linkage switch, Overlay kind, auto snapping).
 * Kept in `shortcut-store.ts` alongside other per-browser editor preferences; read and written
 * ONLY when `BRAND_STUDIO_EDITOR_V2_TRACKS` is open (C6).
 */
export const TRACKS_PREFS_KEY = 'twings_editor_tracks_prefs_v1';

export function loadTracksPrefs(): TracksPrefs {
  try {
    const raw = window.localStorage.getItem(TRACKS_PREFS_KEY);
    return raw ? parseTracksPrefs(JSON.parse(raw)) : p10DefaultTrackToggles();
  } catch {
    return p10DefaultTrackToggles();
  }
}

export function saveTracksPrefs(prefs: TracksPrefs): void {
  try {
    window.localStorage.setItem(TRACKS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: keep preferences in memory for this visit.
  }
}
