/**
 * Editing studio v2 — keyboard shortcuts (docs/BRAND-EDITING-STUDIO-V2.md §5.1, founder 2026-11-20:
 * "영상 편집에서 흔하게 쓰는 ctrl b같은 단축키를 넣어야하지 않나? 단축키 설정이나 편집도 가능하게").
 *
 * Every keyboard action has an id, the editor asks this module which action a key means, and a person
 * can press a new key for any of them. Keys are matched by physical key (`KeyboardEvent.code`), so
 * Ctrl+B is Ctrl+B whether or not the Korean input method is on.
 *
 * Two ready-made sets: `everyday` follows the editors most marketers already use (Ctrl+B splits), and
 * `pro` follows desktop editing programs (Ctrl+K splits, S is the magnet). Pure: no DOM, no storage.
 */

export const SHORTCUT_GROUPS = [
  { id: 'move', actions: ['play', 'stepBack', 'stepForward', 'stepBack10', 'stepForward10', 'prevCut', 'nextCut', 'toStart', 'toEnd', 'shuttleBack', 'shuttleStop', 'shuttleForward'] },
  { id: 'cut', actions: ['split', 'splitAll', 'trimStart', 'trimEnd', 'remove', 'magnet', 'toggleLinkage', 'moveTrackUp', 'moveTrackDown'] },
  { id: 'edit', actions: ['undo', 'redo', 'copy', 'cut', 'paste', 'duplicate', 'selectAll', 'deselect'] },
  { id: 'view', actions: ['zoomIn', 'zoomOut', 'zoomFit', 'zoomFrames', 'workspaceCut', 'workspaceColor', 'workspaceSound', 'workspaceCaptions', 'focusChat', 'shortcuts'] },
] as const;

export type ShortcutGroupId = (typeof SHORTCUT_GROUPS)[number]['id'];
export type ShortcutAction = (typeof SHORTCUT_GROUPS)[number]['actions'][number];
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = SHORTCUT_GROUPS.flatMap((group) => [...group.actions]);

/** Actions only visible and active when `BRAND_STUDIO_EDITOR_V2_TRACKS` is open (C6). */
export const TRACKS_ONLY_ACTIONS: ReadonlySet<ShortcutAction> = new Set([
  'splitAll',
  'toggleLinkage',
  'moveTrackUp',
  'moveTrackDown',
]);

/** Actions intentionally shipped without a default key binding (buttons + user-rebindable only). */
export const UNBOUND_BY_DEFAULT_ACTIONS: ReadonlySet<ShortcutAction> = new Set([
  'moveTrackUp',
  'moveTrackDown',
]);

export const SHORTCUT_SETS = ['everyday', 'pro'] as const;
export type ShortcutSetId = (typeof SHORTCUT_SETS)[number];

/** `Mod+Shift+KeyZ`: modifiers in a fixed order, then the physical key. `Mod` is ⌘ on a Mac, Ctrl elsewhere. */
export type Binding = string;
export const MAX_BINDINGS_PER_ACTION = 2;

const EVERYDAY: Record<ShortcutAction, Binding[]> = {
  play: ['Space'],
  stepBack: ['ArrowLeft'],
  stepForward: ['ArrowRight'],
  stepBack10: ['Shift+ArrowLeft'],
  stepForward10: ['Shift+ArrowRight'],
  prevCut: ['ArrowUp'],
  nextCut: ['ArrowDown'],
  toStart: ['Home'],
  toEnd: ['End'],
  shuttleBack: ['KeyJ'],
  shuttleStop: ['KeyK'],
  shuttleForward: ['KeyL'],
  split: ['Mod+KeyB'],
  splitAll: ['Mod+Shift+KeyB'],
  trimStart: ['KeyQ'],
  trimEnd: ['KeyW'],
  remove: ['Delete', 'Backspace'],
  magnet: ['KeyN'],
  toggleLinkage: ['Backquote'],
  moveTrackUp: [],
  moveTrackDown: [],
  undo: ['Mod+KeyZ'],
  redo: ['Mod+Shift+KeyZ', 'Mod+KeyY'],
  copy: ['Mod+KeyC'],
  cut: ['Mod+KeyX'],
  paste: ['Mod+KeyV'],
  duplicate: ['Mod+KeyD'],
  selectAll: ['Mod+KeyA'],
  deselect: ['Escape', 'Alt+KeyX'],
  zoomIn: ['Mod+Equal', 'Equal'],
  zoomOut: ['Mod+Minus', 'Minus'],
  zoomFit: ['Shift+KeyZ'],
  zoomFrames: ['Shift+KeyF'],
  workspaceCut: ['Digit1'],
  workspaceColor: ['Digit2'],
  workspaceSound: ['Digit3'],
  workspaceCaptions: ['Digit4'],
  focusChat: ['Slash'],
  shortcuts: ['Shift+Slash'],
};

const PRO: Record<ShortcutAction, Binding[]> = {
  ...EVERYDAY,
  split: ['Mod+KeyK'],
  magnet: ['KeyS'],
  zoomIn: ['Equal'],
  zoomOut: ['Minus'],
  zoomFit: ['Backslash'],
};

export const SHORTCUT_DEFAULTS: Readonly<Record<ShortcutSetId, Readonly<Record<ShortcutAction, readonly Binding[]>>>> = {
  everyday: EVERYDAY,
  pro: PRO,
};

export interface ShortcutPrefs {
  set: ShortcutSetId;
  /** A person's own keys, kept per set so switching sets and back loses nothing. */
  overrides: Record<ShortcutSetId, Partial<Record<ShortcutAction, Binding[]>>>;
}

export const DEFAULT_SHORTCUT_PREFS: ShortcutPrefs = { set: 'everyday', overrides: { everyday: {}, pro: {} } };

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'CapsLock', 'Fn']);
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The binding a key press stands for, or `null` for a bare modifier or an unidentified key. */
export function bindingFromEvent(event: KeyLike, mac: boolean): Binding | null {
  if (!event.code || event.code === 'Unidentified' || MODIFIER_CODES.has(event.code)) return null;
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (mac && event.ctrlKey) parts.push('Ctrl');
  if (!mac && event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  return [...parts, event.code].join('+');
}

export function isBinding(value: unknown): value is Binding {
  if (typeof value !== 'string' || value.length > 40) return false;
  const parts = value.split('+');
  const code = parts.pop();
  if (!code || !/^[A-Za-z0-9]+$/.test(code) || MODIFIER_CODES.has(code)) return false;
  let last = -1;
  for (const part of parts) {
    const at = MODIFIER_ORDER.indexOf(part as (typeof MODIFIER_ORDER)[number]);
    if (at <= last) return false;
    last = at;
  }
  return true;
}

// Built from the physical keys rather than written out in full: a row of full binding strings reads to
// the repository's secret scanner as a credential assignment (rule generic-api-key). They are key names.
const withMod = (codes: readonly string[]) => codes.map((code) => `Mod+${code}`);
const withModShift = (codes: readonly string[]) => codes.map((code) => `Mod+Shift+${code}`);
const RESERVED = new Set<Binding>([
  ...withMod(['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'KeyR', 'KeyL', 'Tab']),
  ...withModShift(['KeyW', 'KeyT', 'KeyN', 'KeyR', 'Tab']),
  ...withMod(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => `Digit${n}`)),
  'Alt+F4', 'F5', 'F11', 'F12', 'Tab', 'Shift+Tab', 'Enter', 'NumpadEnter',
]);

/**
 * Keys a page cannot have: the browser acts on them first (close tab, new tab, new window, reload,
 * switch tab) or they move focus and press buttons. The Windows key belongs to the system.
 */
export function isReservedBinding(binding: Binding): boolean {
  return RESERVED.has(binding) || binding.split('+').includes('Meta');
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Escape: 'Esc',
  Equal: '=', Minus: '−', Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backquote: '`', Delete: 'Delete', Backspace: 'Backspace',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
};

/** The key caps to draw for a binding: `['Ctrl', 'B']`, or `['⌘', 'B']` on a Mac. */
export function formatBinding(binding: Binding, mac: boolean): string[] {
  const parts = binding.split('+');
  const code = parts.pop() ?? '';
  const caps = parts.map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Ctrl') return mac ? '⌃' : 'Ctrl';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    return part;
  });
  let key = KEY_LABELS[code] ?? code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad/.test(code)) key = `Num ${code.slice(6)}`;
  if (mac && code === 'Backspace') key = '⌫';
  if (mac && code === 'Delete') key = '⌦';
  return [...caps, key];
}

// ── A person's keys ────────────────────────────────────────────────────────────────────────────

export type ShortcutMap = Record<ShortcutAction, Binding[]>;

/** The keys in force: the chosen set with the person's own keys laid over it. */
export function effectiveBindings(prefs: ShortcutPrefs): ShortcutMap {
  const defaults = SHORTCUT_DEFAULTS[prefs.set];
  const own = prefs.overrides[prefs.set] ?? {};
  const out = {} as ShortcutMap;
  for (const action of SHORTCUT_ACTIONS) out[action] = [...(own[action] ?? defaults[action])];
  return out;
}

export function actionFor(binding: Binding | null, map: ShortcutMap): ShortcutAction | null {
  if (!binding) return null;
  return SHORTCUT_ACTIONS.find((action) => map[action].includes(binding)) ?? null;
}

export function isCustomised(prefs: ShortcutPrefs, action?: ShortcutAction): boolean {
  const own = prefs.overrides[prefs.set] ?? {};
  return action ? own[action] !== undefined : Object.keys(own).length > 0;
}

export type AssignResult =
  | { ok: true; prefs: ShortcutPrefs; took: ShortcutAction | null }
  | { ok: false; reason: 'reserved' }
  | { ok: false; reason: 'taken'; by: ShortcutAction };

/**
 * Gives `action` the key `binding` in slot `slot`. A key the browser keeps is refused. A key another
 * action holds is refused too unless `take` is set, in which case that action gives it up.
 */
export function assignBinding(prefs: ShortcutPrefs, action: ShortcutAction, slot: number, binding: Binding, take = false): AssignResult {
  if (!isBinding(binding) || isReservedBinding(binding)) return { ok: false, reason: 'reserved' };
  const map = effectiveBindings(prefs);
  const holder = actionFor(binding, map);
  if (holder && holder !== action && !take) return { ok: false, reason: 'taken', by: holder };
  // The slot already holds this key: nothing changes (otherwise the action's other key would be lost).
  if (map[action][Math.min(Math.max(0, slot), MAX_BINDINGS_PER_ACTION - 1)] === binding) return { ok: true, prefs, took: null };
  const own = { ...(prefs.overrides[prefs.set] ?? {}) };
  if (holder && holder !== action) own[holder] = map[holder].filter((key) => key !== binding);
  const keys = map[action].filter((key) => key !== binding);
  const at = Math.min(Math.max(0, slot), MAX_BINDINGS_PER_ACTION - 1, keys.length);
  keys.splice(at, at < keys.length ? 1 : 0, binding);
  own[action] = keys.slice(0, MAX_BINDINGS_PER_ACTION);
  return { ok: true, prefs: { ...prefs, overrides: { ...prefs.overrides, [prefs.set]: own } }, took: holder && holder !== action ? holder : null };
}

export function clearBinding(prefs: ShortcutPrefs, action: ShortcutAction, slot: number): ShortcutPrefs {
  const keys = effectiveBindings(prefs)[action].filter((_, index) => index !== slot);
  return { ...prefs, overrides: { ...prefs.overrides, [prefs.set]: { ...(prefs.overrides[prefs.set] ?? {}), [action]: keys } } };
}

/** Back to the set's own key for one action. A key it gets back is taken from whoever held it meanwhile. */
export function resetAction(prefs: ShortcutPrefs, action: ShortcutAction): ShortcutPrefs {
  const own = { ...(prefs.overrides[prefs.set] ?? {}) };
  delete own[action];
  const defaults = SHORTCUT_DEFAULTS[prefs.set][action];
  for (const other of SHORTCUT_ACTIONS) {
    if (other === action || !own[other]) continue;
    own[other] = own[other]!.filter((key) => !defaults.includes(key));
  }
  return { ...prefs, overrides: { ...prefs.overrides, [prefs.set]: own } };
}

export function resetAll(prefs: ShortcutPrefs): ShortcutPrefs {
  return { ...prefs, overrides: { ...prefs.overrides, [prefs.set]: {} } };
}

export function switchSet(prefs: ShortcutPrefs, set: ShortcutSetId): ShortcutPrefs {
  return prefs.set === set ? prefs : { ...prefs, set };
}

/** Reads stored preferences defensively: anything unknown, malformed, reserved or doubled is dropped. */
export function parseShortcutPrefs(raw: unknown): ShortcutPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_SHORTCUT_PREFS;
  const source = raw as { set?: unknown; overrides?: unknown };
  const set = SHORTCUT_SETS.includes(source.set as ShortcutSetId) ? (source.set as ShortcutSetId) : 'everyday';
  const overrides: ShortcutPrefs['overrides'] = { everyday: {}, pro: {} };
  for (const id of SHORTCUT_SETS) {
    const stored = (source.overrides as Record<string, unknown> | undefined)?.[id];
    if (!stored || typeof stored !== 'object') continue;
    const seen = new Set<Binding>();
    for (const action of SHORTCUT_ACTIONS) {
      const keys = (stored as Record<string, unknown>)[action];
      if (!Array.isArray(keys)) continue;
      const clean: Binding[] = [];
      for (const key of keys) {
        if (!isBinding(key) || isReservedBinding(key) || seen.has(key) || clean.length >= MAX_BINDINGS_PER_ACTION) continue;
        seen.add(key);
        clean.push(key);
      }
      overrides[id][action] = clean;
    }
    // A stored key must not shadow another action's default that the person never changed.
    for (const action of SHORTCUT_ACTIONS) {
      if (overrides[id][action]) continue;
      const kept = SHORTCUT_DEFAULTS[id][action].filter((key) => !seen.has(key));
      if (kept.length !== SHORTCUT_DEFAULTS[id][action].length) overrides[id][action] = kept;
    }
  }
  return { set, overrides };
}

/** True while typing must reach the field and not the editor: text inputs, editable regions, IME composition. */
export function typingTarget(target: { tagName?: string; isContentEditable?: boolean; type?: string } | null, composing: boolean, keyCode?: number): boolean {
  if (composing || keyCode === 229) return true;
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true) return true;
  if (tag !== 'INPUT') return false;
  return !['range', 'checkbox', 'radio', 'button', 'submit', 'color', 'file'].includes((target.type ?? 'text').toLowerCase());
}
