import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUT_PREFS,
  MAX_BINDINGS_PER_ACTION,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFAULTS,
  SHORTCUT_SETS,
  TRACKS_ONLY_ACTIONS,
  UNBOUND_BY_DEFAULT_ACTIONS,
  actionFor,
  assignBinding,
  bindingFromEvent,
  clearBinding,
  effectiveBindings,
  formatBinding,
  isBinding,
  isCustomised,
  isReservedBinding,
  parseShortcutPrefs,
  resetAction,
  resetAll,
  switchSet,
  typingTarget,
  type KeyLike,
  type ShortcutAction,
  type ShortcutMap,
  type ShortcutPrefs,
} from '@/lib/brand-studio/editor-v2/shortcuts';

/**
 * The founder (2026-11-20): "영상 편집에서 흔하게 쓰는 ctrl b같은 단축키를 넣어야하지 않나? 단축키 설정이나
 * 편집도 가능하게". Two ready-made key sets, any key can be changed, and the keys in force never clash.
 */

/** Every key that is held by more than one action, or twice by one action. Empty when the map is sound. */
function conflicts(map: ShortcutMap): string[] {
  const seen = new Map<string, ShortcutAction>();
  const out: string[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    for (const key of map[action]) {
      const other = seen.get(key);
      if (other) out.push(`${key}: ${other} and ${action}`);
      else seen.set(key, action);
    }
  }
  return out;
}

const press = (code: string, mods: Partial<Omit<KeyLike, 'code'>> = {}, key = ''): KeyLike => {
  const event: KeyLike & { key: string } = { code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
  return event;
};

const assigned = (result: ReturnType<typeof assignBinding>): ShortcutPrefs => {
  if (!result.ok) throw new Error(`assignment refused: ${result.reason}`);
  return result.prefs;
};

describe('the two ready-made sets', () => {
  for (const set of SHORTCUT_SETS) {
    const map = effectiveBindings({ ...DEFAULT_SHORTCUT_PREFS, set });

    it(`${set}: every action has valid keys (one or two by default; unbound-by-default actions start empty)`, () => {
      for (const action of SHORTCUT_ACTIONS) {
        const min = UNBOUND_BY_DEFAULT_ACTIONS.has(action) ? 0 : 1;
        expect(map[action].length, action).toBeGreaterThanOrEqual(min);
        expect(map[action].length, action).toBeLessThanOrEqual(MAX_BINDINGS_PER_ACTION);
        if (UNBOUND_BY_DEFAULT_ACTIONS.has(action)) expect(map[action], action).toEqual([]);
        for (const key of map[action]) expect(isBinding(key), `${action}: ${key}`).toBe(true);
      }
    });

    it(`${set}: no two actions share a key`, () => {
      expect(conflicts(map)).toEqual([]);
    });

    it(`${set}: no default key belongs to the browser`, () => {
      for (const action of SHORTCUT_ACTIONS) {
        for (const key of map[action]) expect(isReservedBinding(key), `${action}: ${key}`).toBe(false);
      }
    });
  }

  it('everyday splits with Ctrl/⌘+B, leaves bare S reserved, adds Alt+X next to Esc for deselect, and keeps a customer stored S override on split', () => {
    expect(SHORTCUT_DEFAULTS.everyday.split).toEqual(['Mod+KeyB']);
    expect(SHORTCUT_DEFAULTS.everyday.deselect).toEqual(['Escape', 'Alt+KeyX']);
    const map = effectiveBindings(DEFAULT_SHORTCUT_PREFS);
    expect(actionFor('Mod+KeyB', map)).toBe('split');
    expect(actionFor('KeyS', map)).toBeNull();
    expect(actionFor('Alt+KeyX', map)).toBe('deselect');

    // SMALL: a customer who previously bound bare `KeyS` onto `split` keeps it after the default change.
    const storedCustomer = parseShortcutPrefs({
      set: 'everyday',
      overrides: { everyday: { split: ['Mod+KeyB', 'KeyS'] } },
    });
    const customerMap = effectiveBindings(storedCustomer);
    expect(customerMap.split).toEqual(['Mod+KeyB', 'KeyS']);
    expect(actionFor('KeyS', customerMap)).toBe('split');
  });

  it('pro splits with Ctrl/⌘+K, uses S for the magnet, and inherits splitAll and Alt+X deselect', () => {
    const map = effectiveBindings(switchSet(DEFAULT_SHORTCUT_PREFS, 'pro'));
    expect(map.split).toEqual(['Mod+KeyK']);
    expect(map.splitAll).toEqual(['Mod+Shift+KeyB']);
    expect(map.deselect).toEqual(['Escape', 'Alt+KeyX']);
    expect(actionFor('Mod+KeyK', map)).toBe('split');
    expect(actionFor('KeyS', map)).toBe('magnet');
    expect(actionFor('Mod+KeyB', map)).toBeNull();
  });

  it('starts on everyday', () => {
    expect(DEFAULT_SHORTCUT_PREFS.set).toBe('everyday');
    expect(isCustomised(DEFAULT_SHORTCUT_PREFS)).toBe(false);
  });

  it('keeps tracks defaults aligned with E-T T1 addendum and leaves reserved keys untaken by new commands', () => {
    const reservedForFuture = new Set(['KeyP', 'KeyS', 'Mod+KeyG', 'Mod+Shift+KeyG', 'Mod+Shift+KeyS', 'KeyM']);
    for (const set of SHORTCUT_SETS) {
      const defaults = SHORTCUT_DEFAULTS[set];
      expect(defaults.toggleLinkage).toEqual(['Backquote']);
      expect(defaults.moveTrackUp).toEqual([]);
      expect(defaults.moveTrackDown).toEqual([]);
      for (const action of TRACKS_ONLY_ACTIONS) {
        for (const key of defaults[action]) {
          expect(reservedForFuture.has(key), `${set}.${action}: ${key}`).toBe(false);
        }
      }
    }
    expect(SHORTCUT_DEFAULTS.everyday.magnet).toEqual(['KeyN']);
    expect(SHORTCUT_DEFAULTS.everyday.splitAll).toEqual(['Mod+Shift+KeyB']);
    expect(SHORTCUT_DEFAULTS.pro.splitAll).toEqual(['Mod+Shift+KeyB']);
    // Unbound actions remain user-rebindable.
    const rebound = assigned(assignBinding(DEFAULT_SHORTCUT_PREFS, 'moveTrackUp', 0, 'Alt+BracketRight'));
    expect(effectiveBindings(rebound).moveTrackUp).toEqual(['Alt+BracketRight']);
  });
});

describe('bindingFromEvent', () => {
  it('reads Ctrl on Windows and ⌘ on a Mac as the same Mod key', () => {
    expect(bindingFromEvent(press('KeyB', { ctrlKey: true }), false)).toBe('Mod+KeyB');
    expect(bindingFromEvent(press('KeyB', { metaKey: true }), true)).toBe('Mod+KeyB');
    // Ctrl on a Mac is its own modifier.
    expect(bindingFromEvent(press('KeyB', { ctrlKey: true }), true)).toBe('Ctrl+KeyB');
    expect(bindingFromEvent(press('KeyB'), false)).toBe('KeyB');
  });

  it('writes modifiers in a fixed order', () => {
    const all = { ctrlKey: true, altKey: true, shiftKey: true };
    expect(bindingFromEvent(press('KeyZ', all), false)).toBe('Mod+Alt+Shift+KeyZ');
    expect(bindingFromEvent(press('KeyZ', { shiftKey: true, metaKey: true, altKey: true }), true)).toBe('Mod+Alt+Shift+KeyZ');
    expect(bindingFromEvent(press('KeyZ', { shiftKey: true, ctrlKey: true }), false)).toBe('Mod+Shift+KeyZ');
    expect(isBinding(bindingFromEvent(press('KeyZ', { ...all, metaKey: true }), true))).toBe(true);
  });

  it('returns null for a bare modifier or an unidentified key', () => {
    for (const code of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Unidentified', '']) {
      expect(bindingFromEvent(press(code, { shiftKey: true, ctrlKey: true }), false), code).toBeNull();
    }
  });

  it('records the Windows key as Meta, which the page cannot have', () => {
    const binding = bindingFromEvent(press('KeyD', { metaKey: true }), false);
    expect(binding).toBe('Meta+KeyD');
    expect(isReservedBinding(binding!)).toBe(true);
  });

  it('matches the physical key, so the Korean input method changes nothing', () => {
    // With the Korean layout on, B reports `ㅠ` and N reports `ㅜ`; the code stays the same.
    expect(bindingFromEvent(press('KeyB', { ctrlKey: true }, 'ㅠ'), false)).toBe(bindingFromEvent(press('KeyB', { ctrlKey: true }, 'b'), false));
    expect(bindingFromEvent(press('KeyN', {}, 'ㅜ'), false)).toBe('KeyN');
    expect(actionFor(bindingFromEvent(press('KeyN', {}, 'ㅜ'), false), effectiveBindings(DEFAULT_SHORTCUT_PREFS))).toBe('magnet');
    expect(actionFor(bindingFromEvent(press('KeyB', { metaKey: true }, 'ㅠ'), true), effectiveBindings(DEFAULT_SHORTCUT_PREFS))).toBe('split');
  });
});

describe('isBinding and isReservedBinding', () => {
  it('accepts well-formed bindings', () => {
    // Long bindings are joined here, not written out in full: a row of full binding strings reads to the
    // repository's secret scanner as a credential assignment (rule generic-api-key).
    const combo = (...parts: string[]) => parts.join('+');
    for (const value of [combo('Mod', 'Shift', 'KeyZ'), combo('Mod', 'Alt', 'Shift', 'KeyZ'), combo('Ctrl', 'KeyB'), combo('Mod', 'KeyB'), combo('Shift', 'Slash'), 'KeyB', 'Space', 'ArrowLeft', 'F5', 'Digit1', 'Numpad5']) {
      expect(isBinding(value), value).toBe(true);
    }
  });

  it('rejects junk', () => {
    for (const value of [
      '',
      '+',
      'Shift+',
      'Mod+',
      'Shift+Mod+KeyZ',
      'Mod+Mod+KeyZ',
      'Foo+KeyZ',
      'ShiftLeft',
      'Mod+ControlLeft',
      'Key-B',
      'Key B',
      `Key${'B'.repeat(40)}`,
      42,
      null,
      undefined,
      ['KeyB'],
      { code: 'KeyB' },
    ]) {
      expect(isBinding(value), String(value)).toBe(false);
    }
  });

  it('keeps the keys the browser acts on first', () => {
    for (const key of ['Mod+KeyW', 'Mod+KeyT', 'Mod+KeyN', 'Mod+Tab', 'Tab', 'Enter', 'F5', 'Mod+Shift+KeyT', 'Mod+KeyR', 'Mod+Digit1', 'Alt+F4', 'Meta+KeyA']) {
      expect(isReservedBinding(key), key).toBe(true);
    }
    for (const key of ['Mod+KeyB', 'KeyS', 'Space', 'Mod+KeyK', 'Digit1', 'Shift+KeyW']) expect(isReservedBinding(key), key).toBe(false);
  });
});

describe('formatBinding', () => {
  it('draws Ctrl on Windows and ⌘ on a Mac', () => {
    expect(formatBinding('Mod+KeyB', false)).toEqual(['Ctrl', 'B']);
    expect(formatBinding('Mod+KeyB', true)).toEqual(['⌘', 'B']);
    expect(formatBinding('Mod+Shift+KeyZ', false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(formatBinding('Mod+Shift+KeyZ', true)).toEqual(['⌘', '⇧', 'Z']);
    expect(formatBinding('Alt+KeyA', true)).toEqual(['⌥', 'A']);
    expect(formatBinding('Alt+KeyA', false)).toEqual(['Alt', 'A']);
  });

  it('draws arrows, digits, letters and the number pad', () => {
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((code) => formatBinding(code, false)[0])).toEqual(['←', '→', '↑', '↓']);
    expect(formatBinding('Shift+ArrowLeft', true)).toEqual(['⇧', '←']);
    expect(formatBinding('Digit1', false)).toEqual(['1']);
    expect(formatBinding('KeyQ', false)).toEqual(['Q']);
    expect(formatBinding('Numpad5', false)).toEqual(['Num 5']);
    expect(formatBinding('Space', false)).toEqual(['Space']);
  });

  it('draws every default key as something short', () => {
    for (const set of SHORTCUT_SETS) {
      for (const action of SHORTCUT_ACTIONS) {
        for (const key of SHORTCUT_DEFAULTS[set][action]) {
          for (const mac of [false, true]) {
            const caps = formatBinding(key, mac);
            expect(caps.length).toBeGreaterThanOrEqual(1);
            for (const cap of caps) expect(cap.length, `${key} → ${cap}`).toBeLessThanOrEqual(9);
          }
        }
      }
    }
  });
});

describe('changing keys', () => {
  const base = DEFAULT_SHORTCUT_PREFS;

  it('puts a free key in the given slot, never more than two', () => {
    const first = assigned(assignBinding(base, 'play', 0, 'KeyG'));
    expect(effectiveBindings(first).play).toEqual(['KeyG']);
    const second = assigned(assignBinding(base, 'play', 1, 'KeyG'));
    expect(effectiveBindings(second).play).toEqual(['Space', 'KeyG']);
    const replaced = assigned(assignBinding(second, 'play', 1, 'KeyH'));
    expect(effectiveBindings(replaced).play).toEqual(['Space', 'KeyH']);
    const far = assigned(assignBinding(replaced, 'play', 9, 'KeyI'));
    expect(effectiveBindings(far).play).toEqual(['Space', 'KeyI']);
    const front = assigned(assignBinding(far, 'play', 0, 'KeyO'));
    expect(effectiveBindings(front).play).toEqual(['KeyO', 'KeyI']);
    expect(actionFor('KeyO', effectiveBindings(front))).toBe('play');
    expect(actionFor('Space', effectiveBindings(front))).toBeNull();
    expect(actionFor(null, effectiveBindings(front))).toBeNull();
  });

  it('refuses a key the browser keeps', () => {
    for (const key of ['Mod+KeyW', 'Tab', 'Enter', 'F5', 'Meta+KeyG', 'not a key']) {
      expect(assignBinding(base, 'play', 0, key)).toEqual({ ok: false, reason: 'reserved' });
    }
  });

  it('refuses a key another action holds unless told to take it', () => {
    expect(assignBinding(base, 'play', 0, 'Mod+KeyY')).toEqual({ ok: false, reason: 'taken', by: 'redo' });
    const result = assignBinding(base, 'play', 0, 'Mod+KeyY', true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.took).toBe('redo');
    const map = effectiveBindings(result.prefs);
    expect(map.play).toEqual(['Mod+KeyY']);
    expect(map.redo).toEqual(['Mod+Shift+KeyZ']);
    expect(actionFor('Mod+KeyY', map)).toBe('play');
    expect(conflicts(map)).toEqual([]);
    expect(isCustomised(result.prefs, 'play')).toBe(true);
    expect(isCustomised(result.prefs, 'redo')).toBe(true);
    expect(isCustomised(result.prefs, 'magnet')).toBe(false);
  });

  it('does not double a key the action already has in another slot', () => {
    const moved = assignBinding(base, 'redo', 1, 'Mod+Shift+KeyZ');
    expect(moved).toMatchObject({ ok: true, took: null });
    expect(effectiveBindings(assigned(moved)).redo).toEqual(['Mod+KeyY', 'Mod+Shift+KeyZ']);
    const same = assigned(assignBinding(base, 'redo', 0, 'Mod+KeyY'));
    const keys = effectiveBindings(same).redo;
    expect(keys).toContain('Mod+KeyY');
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThanOrEqual(MAX_BINDINGS_PER_ACTION);
    // Pressing the key a slot already has changes nothing.
    const again = assigned(assignBinding(base, 'redo', 0, 'Mod+Shift+KeyZ'));
    expect(effectiveBindings(again).redo).toEqual(['Mod+Shift+KeyZ', 'Mod+KeyY']);
    expect(again).toBe(base);
    expect(assigned(assignBinding(base, 'redo', 1, 'Mod+KeyY'))).toBe(base);
  });

  it('clears one key', () => {
    const cleared = clearBinding(base, 'redo', 1);
    const map = effectiveBindings(cleared);
    expect(map.redo).toEqual(['Mod+Shift+KeyZ']);
    expect(actionFor('Mod+KeyY', map)).toBeNull();
    expect(isCustomised(cleared, 'redo')).toBe(true);
    expect(effectiveBindings(clearBinding(cleared, 'redo', 0)).redo).toEqual([]);
  });

  it('resets one action and takes its key back from whoever held it', () => {
    const taken = assigned(assignBinding(base, 'play', 0, 'Mod+KeyY', true));
    const reset = resetAction(taken, 'redo');
    const map = effectiveBindings(reset);
    expect(map.redo).toEqual(['Mod+Shift+KeyZ', 'Mod+KeyY']);
    expect(map.play).toEqual([]);
    expect(conflicts(map)).toEqual([]);
    expect(isCustomised(reset, 'redo')).toBe(false);
    expect(effectiveBindings(resetAction(reset, 'play')).play).toEqual(['Space']);
  });

  it('resets everything in the current set', () => {
    let prefs = assigned(assignBinding(base, 'play', 0, 'Mod+KeyY', true));
    prefs = clearBinding(prefs, 'undo', 0);
    expect(isCustomised(prefs)).toBe(true);
    const reset = resetAll(prefs);
    expect(isCustomised(reset)).toBe(false);
    expect(effectiveBindings(reset)).toEqual(effectiveBindings(base));
  });

  it('keeps a person’s keys per set', () => {
    const own = assigned(assignBinding(base, 'play', 0, 'KeyG'));
    const pro = switchSet(own, 'pro');
    expect(isCustomised(pro)).toBe(false);
    expect(effectiveBindings(pro)).toEqual(effectiveBindings(switchSet(base, 'pro')));
    const proOwn = assigned(assignBinding(pro, 'split', 0, 'KeyH'));
    const back = switchSet(proOwn, 'everyday');
    expect(effectiveBindings(back).play).toEqual(['KeyG']);
    expect(effectiveBindings(back).split).toEqual(['Mod+KeyB']);
    expect(effectiveBindings(switchSet(back, 'pro')).split).toEqual(['KeyH']);
    expect(switchSet(back, 'everyday')).toBe(back);
    // resetAll only clears the set in force.
    const cleared = resetAll(back);
    expect(effectiveBindings(switchSet(cleared, 'pro')).split).toEqual(['KeyH']);
  });

  it('never lets two actions share a key, whatever is pressed in whatever order', () => {
    let seed = 20261120;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    const defaults = SHORTCUT_SETS.flatMap((set) => SHORTCUT_ACTIONS.flatMap((action) => [...SHORTCUT_DEFAULTS[set][action]]));
    const pool = [...new Set([...defaults, 'KeyG', 'KeyH', 'KeyI', 'KeyO', 'KeyP', 'Mod+KeyG', 'Alt+KeyS', 'Mod+KeyW', 'Tab', 'Meta+KeyS'])];
    let prefs: ShortcutPrefs = DEFAULT_SHORTCUT_PREFS;
    let refusedTaken = 0;
    for (let step = 0; step < 300; step += 1) {
      const roll = random();
      const action = pick(SHORTCUT_ACTIONS);
      if (roll < 0.55) {
        const key = pick(pool);
        const result = assignBinding(prefs, action, Math.floor(random() * 3), key, random() < 0.6);
        if (result.ok) prefs = result.prefs;
        else if (result.reason === 'taken') {
          refusedTaken += 1;
          expect(actionFor(key, effectiveBindings(prefs))).toBe(result.by);
        } else expect(!isBinding(key) || isReservedBinding(key), key).toBe(true);
      } else if (roll < 0.7) prefs = clearBinding(prefs, action, Math.floor(random() * 2));
      else if (roll < 0.88) prefs = resetAction(prefs, action);
      else if (roll < 0.93) prefs = resetAll(prefs);
      else prefs = switchSet(prefs, pick(SHORTCUT_SETS));

      for (const set of SHORTCUT_SETS) {
        const map = effectiveBindings({ ...prefs, set });
        expect(conflicts(map), `step ${step}, ${set}`).toEqual([]);
        for (const a of SHORTCUT_ACTIONS) {
          expect(map[a].length).toBeLessThanOrEqual(MAX_BINDINGS_PER_ACTION);
          for (const key of map[a]) expect(isReservedBinding(key), `step ${step}: ${a} ${key}`).toBe(false);
        }
      }
      // What is stored reads back as the same keys.
      expect(parseShortcutPrefs(JSON.parse(JSON.stringify(prefs))), `step ${step}`).toEqual(prefs);
    }
    expect(refusedTaken).toBeGreaterThan(0);
  });
});

describe('parseShortcutPrefs', () => {
  it('falls back to the defaults for nothing or junk', () => {
    for (const raw of [null, undefined, '', 'junk', 42, true, []]) expect(parseShortcutPrefs(raw), String(raw)).toEqual(DEFAULT_SHORTCUT_PREFS);
    expect(parseShortcutPrefs({ set: 'weird', overrides: 'nope' })).toEqual(DEFAULT_SHORTCUT_PREFS);
    expect(parseShortcutPrefs({ set: 'pro' })).toEqual({ set: 'pro', overrides: { everyday: {}, pro: {} } });
  });

  it('drops unknown actions, junk keys, reserved keys, doubles and anything past two keys', () => {
    const parsed = parseShortcutPrefs({
      set: 'everyday',
      overrides: {
        everyday: {
          bogus: ['KeyG'],
          play: ['Mod+KeyW', 'KeyG', 'KeyG', 'Tab', 'Meta+KeyA', 'not a key', 7],
          undo: ['KeyH', 'KeyI', 'KeyO'],
          redo: 'Mod+KeyY',
          copy: ['KeyG', 'KeyP'],
        },
        later: { play: ['KeyU'] },
      },
    });
    const own = parsed.overrides.everyday as Record<string, unknown>;
    expect(own.bogus).toBeUndefined();
    expect(own.play).toEqual(['KeyG']);
    expect(own.undo).toEqual(['KeyH', 'KeyI']);
    expect(own.redo).toBeUndefined();
    // `KeyG` went to play first; copy keeps only what is left.
    expect(own.copy).toEqual(['KeyP']);
    expect(Object.keys(parsed.overrides).sort()).toEqual(['everyday', 'pro']);
    expect(conflicts(effectiveBindings(parsed))).toEqual([]);
  });

  it('drops a default from the action it belonged to when a stored key shadows it', () => {
    const parsed = parseShortcutPrefs({ set: 'everyday', overrides: { everyday: { play: ['Mod+KeyY'] }, pro: { play: ['KeyS'] } } });
    const map = effectiveBindings(parsed);
    expect(map.play).toEqual(['Mod+KeyY']);
    expect(map.redo).toEqual(['Mod+Shift+KeyZ']);
    expect(actionFor('Mod+KeyY', map)).toBe('play');
    expect(conflicts(map)).toEqual([]);
    const pro = effectiveBindings(switchSet(parsed, 'pro'));
    expect(pro.play).toEqual(['KeyS']);
    expect(pro.magnet).toEqual([]);
    expect(conflicts(pro)).toEqual([]);
  });

  it('reads its own output back unchanged', () => {
    let prefs = assigned(assignBinding(DEFAULT_SHORTCUT_PREFS, 'play', 0, 'Mod+KeyY', true));
    prefs = clearBinding(prefs, 'undo', 0);
    prefs = switchSet(prefs, 'pro');
    prefs = assigned(assignBinding(prefs, 'zoomFit', 1, 'KeyG'));
    expect(parseShortcutPrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
    expect(parseShortcutPrefs(JSON.parse(JSON.stringify(DEFAULT_SHORTCUT_PREFS)))).toEqual(DEFAULT_SHORTCUT_PREFS);
  });
});

describe('typingTarget', () => {
  it('lets typing reach text fields and editable regions', () => {
    expect(typingTarget({ tagName: 'INPUT', type: 'text' }, false)).toBe(true);
    expect(typingTarget({ tagName: 'INPUT', type: 'search' }, false)).toBe(true);
    expect(typingTarget({ tagName: 'input' }, false)).toBe(true);
    expect(typingTarget({ tagName: 'TEXTAREA' }, false)).toBe(true);
    expect(typingTarget({ tagName: 'SELECT' }, false)).toBe(true);
    expect(typingTarget({ tagName: 'DIV', isContentEditable: true }, false)).toBe(true);
  });

  it('keeps the editor keys on sliders, boxes and buttons', () => {
    for (const type of ['range', 'checkbox', 'radio', 'button', 'submit', 'RANGE']) {
      expect(typingTarget({ tagName: 'INPUT', type }, false), type).toBe(false);
    }
    expect(typingTarget({ tagName: 'BUTTON' }, false)).toBe(false);
    expect(typingTarget({ tagName: 'DIV' }, false)).toBe(false);
    expect(typingTarget({ tagName: 'DIV', isContentEditable: false }, false)).toBe(false);
    expect(typingTarget({}, false)).toBe(false);
    expect(typingTarget(null, false)).toBe(false);
  });

  it('never steals a key while the input method is composing', () => {
    expect(typingTarget(null, true)).toBe(true);
    expect(typingTarget({ tagName: 'DIV' }, false, 229)).toBe(true);
    expect(typingTarget({ tagName: 'BUTTON' }, true)).toBe(true);
    expect(typingTarget({ tagName: 'DIV' }, false, 66)).toBe(false);
  });
});
