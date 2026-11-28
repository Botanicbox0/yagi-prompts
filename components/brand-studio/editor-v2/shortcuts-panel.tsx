'use client';

import { useEffect, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import {
  MAX_BINDINGS_PER_ACTION,
  SHORTCUT_DEFAULTS,
  SHORTCUT_GROUPS,
  SHORTCUT_SETS,
  TRACKS_ONLY_ACTIONS,
  actionFor,
  assignBinding,
  bindingFromEvent,
  clearBinding,
  formatBinding,
  isCustomised,
  resetAction,
  resetAll,
  switchSet,
  type Binding,
  type ShortcutAction,
} from '@/lib/brand-studio/editor-v2/shortcuts';
import type { StudioEditorChatCopy } from '@/messages/studio-editor-chat';
import type { StudioEditorTracksCopy } from '@/messages/studio-editor-tracks';
import { EditorIcon } from './icons';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

interface Capture {
  action: ShortcutAction;
  slot: number;
}

interface Notice {
  action: ShortcutAction;
  slot: number;
  binding: Binding;
  /** The action that already holds the key, or `null` when the browser keeps it. */
  by: ShortcutAction | null;
}

/**
 * Every keyboard action with its keys. Press a slot, then the new key: a key the browser keeps is
 * refused with a reason, a key another action holds asks before taking it. Saved in this browser.
 */
export function ShortcutsPanel({
  api,
  chatCopy = null,
  tracksCopy = null,
}: {
  api: EditorApi;
  chatCopy?: StudioEditorChatCopy | null;
  tracksCopy?: StudioEditorTracksCopy | null;
}) {
  const { copy, shortcutPrefs: prefs, shortcutMap: map, mac } = api;
  const s = copy.shortcuts;
  const labelOf = (action: ShortcutAction): string => {
    if (action === 'focusChat') return chatCopy?.shortcutFocusChat ?? '';
    if (action === 'splitAll') return tracksCopy?.actions.splitAll ?? '';
    if (action === 'toggleLinkage') return tracksCopy?.actions.toggleLinkage ?? '';
    if (action === 'moveTrackUp') return tracksCopy?.actions.moveUp ?? '';
    if (action === 'moveTrackDown') return tracksCopy?.actions.moveDown ?? '';
    if (action === 'magnet' && tracksCopy) return tracksCopy.actions.toggleSnap;
    return s.actions[action];
  };
  const savePrefs = (next: typeof prefs) => {
    // SMALL: when the tracks switch is closed, tracks-only keys must NEVER touch browser storage.
    if (!tracksCopy) {
      const prevSet = prefs.overrides[next.set] ?? {};
      const nextSet = { ...(next.overrides[next.set] ?? {}) };
      for (const hidden of TRACKS_ONLY_ACTIONS) {
        if (prevSet[hidden] === undefined) delete nextSet[hidden];
        else nextSet[hidden] = prevSet[hidden];
      }
      api.setShortcutPrefs({
        ...next,
        overrides: { ...next.overrides, [next.set]: nextSet },
      });
      return;
    }
    api.setShortcutPrefs(next);
  };
  const [capture, setCapture] = useState<Capture | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dismissedChatConflict, setDismissedChatConflict] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const live = useRef({ prefs, mac, capture, save: savePrefs, chatOpen: Boolean(chatCopy), tracksOpen: Boolean(tracksCopy) });
  live.current = { prefs, mac, capture, save: savePrefs, chatOpen: Boolean(chatCopy), tracksOpen: Boolean(tracksCopy) };

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  // While a slot is listening, the next key press belongs to it and to nothing else.
  useEffect(() => {
    if (!capture) return;
    const onKey = (event: KeyboardEvent) => {
      const state = live.current;
      if (!state.capture) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return setCapture(null);
      const binding = bindingFromEvent(event, state.mac);
      if (!binding) return;
      let result = assignBinding(state.prefs, state.capture.action, state.capture.slot, binding);
      if (
        !result.ok &&
        result.reason === 'taken' &&
        ((result.by === 'focusChat' && !state.chatOpen) || (TRACKS_ONLY_ACTIONS.has(result.by) && !state.tracksOpen))
      ) {
        result = assignBinding(state.prefs, state.capture.action, state.capture.slot, binding, true);
      }
      if (result.ok) {
        state.save(result.prefs);
        setNotice(null);
      } else {
        setNotice({ ...state.capture, binding, by: result.reason === 'taken' ? result.by : null });
      }
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture]);

  const caps = (binding: Binding) => formatBinding(binding, mac).join(' ');
  const chatDefaultKey = SHORTCUT_DEFAULTS[prefs.set].focusChat[0] ?? 'Slash';
  const chatConflictHolder =
    chatCopy && !dismissedChatConflict && map.focusChat.length === 0
      ? (() => {
          const holder = actionFor(chatDefaultKey, map);
          return holder && holder !== 'focusChat' ? holder : null;
        })()
      : null;
  const take = (target: Notice | null) => {
    if (!target || !target.by) return;
    const result = assignBinding(prefs, target.action, target.slot, target.binding, true);
    if (result.ok) savePrefs(result.prefs);
    setNotice(null);
  };

  return (
    <div className={styles.scrim} onPointerDown={(event) => { if (event.target === event.currentTarget) api.setShortcutsOpen(false); }} data-editor-shortcuts>
      <div className={styles.shortcuts} role="dialog" aria-modal="true" aria-label={s.title} tabIndex={-1} ref={dialog}>
        <header className={styles.shortcutsHead}>
          <h2>{s.title}</h2>
          <div className={styles.seg} role="group" aria-label={s.setLabel}>
            {SHORTCUT_SETS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={prefs.set === id}
                onClick={() => { api.setShortcutPrefs(switchSet(prefs, id)); setNotice(null); setCapture(null); }}
                data-editor-shortcut-set={id}
              >
                {s.sets[id]}
              </button>
            ))}
          </div>
          <button type="button" className={styles.fixBtn} onClick={() => { api.setShortcutPrefs(resetAll(prefs)); setNotice(null); }} disabled={!isCustomised(prefs)} data-editor-shortcut-reset-all>
            {s.resetAll}
          </button>
          <button type="button" className={styles.iconBtn} onClick={() => api.setShortcutsOpen(false)} aria-label={copy.assist.dismiss} title={copy.assist.dismiss}>
            <EditorIcon name="close" />
          </button>
        </header>
        <p className={styles.note}>{s.how} {s.saved}</p>
        <div className={styles.shortcutGroups}>
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.id} className={styles.shortcutGroup}>
              <h3>{s.groups[group.id]}</h3>
              <ul>
                {group.actions.map((action) => {
                  if (action === 'focusChat' && !chatCopy) return null;
                  if (TRACKS_ONLY_ACTIONS.has(action) && !tracksCopy) return null;
                  const label = labelOf(action);
                  const keys = map[action];
                  const slots = Math.min(MAX_BINDINGS_PER_ACTION, keys.length + 1);
                  const rowNotice: Notice | null =
                    notice?.action === action
                      ? notice
                      : action === 'focusChat' && chatConflictHolder
                        ? { action: 'focusChat', slot: 0, binding: chatDefaultKey, by: chatConflictHolder }
                        : null;
                  return (
                    <li key={action} data-editor-shortcut-row={action} data-custom={isCustomised(prefs, action) ? '' : undefined}>
                      <span className={styles.shortcutName}>{label}</span>
                      <span className={styles.shortcutKeys}>
                        {Array.from({ length: slots }, (_, slot) => {
                          const binding = keys[slot];
                          const listening = capture?.action === action && capture.slot === slot;
                          return (
                            <span key={slot} className={styles.keySlot} data-listening={listening ? '' : undefined}>
                              <button
                                type="button"
                                className={styles.keyBtn}
                                data-empty={binding ? undefined : ''}
                                onClick={() => { setNotice(null); setCapture(listening ? null : { action, slot }); }}
                                aria-label={`${label}: ${binding ? caps(binding) : s.add}`}
                                data-editor-shortcut-slot={`${action}:${slot}`}
                              >
                                {listening ? s.press : binding ? caps(binding) : s.add}
                              </button>
                              {binding && !listening && (
                                <button type="button" className={styles.keyClear} onClick={() => { api.setShortcutPrefs(clearBinding(prefs, action, slot)); setNotice(null); }} aria-label={s.clear} title={s.clear}>
                                  <EditorIcon name="close" />
                                </button>
                              )}
                            </span>
                          );
                        })}
                        {isCustomised(prefs, action) && (
                          <button type="button" className={styles.keyReset} onClick={() => { api.setShortcutPrefs(resetAction(prefs, action)); setNotice(null); }} title={s.resetOne} aria-label={s.resetOne}>
                            <EditorIcon name="undo" />
                          </button>
                        )}
                      </span>
                      {rowNotice && (
                        <p className={styles.shortcutNotice} role="alert" data-editor-shortcut-notice={rowNotice.by ? 'taken' : 'reserved'}>
                          <span>
                            <kbd>{caps(rowNotice.binding)}</kbd>
                            {rowNotice.by ? fill(s.taken, { action: labelOf(rowNotice.by) }) : s.reserved}
                          </span>
                          {rowNotice.by && (
                            <button type="button" className={styles.fixBtn} onClick={() => take(rowNotice)} data-editor-shortcut-take>
                              {s.take}
                            </button>
                          )}
                          <button type="button" className={styles.quietBtn} onClick={() => { setNotice(null); if (action === 'focusChat' && chatConflictHolder) setDismissedChatConflict(true); }}>
                            {rowNotice.by ? s.cancel : copy.assist.dismiss}
                          </button>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
