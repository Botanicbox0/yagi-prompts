/**
 * Editing studio v2, V1 — keeping the organization's film in step with the browser key it shares with
 * the current editor and the sound studio (review round 1, items 7 and 8).
 *
 * The current editor reads the key only when it mounts, writes its whole film on every change, and on
 * mount first writes an EMPTY film and then the real one. So a tab of it that has been open since before
 * v2's edits holds a stale copy, and its next change overwrites v2's work; a freshly opened one briefly
 * empties the key. This controller is v2's side of that bargain (the current editor does not change).
 * No React, no DOM: storage and timers are handed in (`tests/brand-studio/editor-v2/film-session.test.ts`).
 *
 * The rules:
 *  (a) a local edit that is not yet written goes to storage (read, merge, write) after a short pause and
 *      at once when the page is hidden; an incoming change never drops it;
 *  (b) a change from another screen is read only after it has settled (`settleMs` after the LAST
 *      notice, reading the key's final value, never the value the notice carried): the transient empty
 *      film of a mounting current editor is never adopted; while it settles nothing is written;
 *  (c) v2 has no edits of its own since it last opened a film (nothing pending, nothing written) → it
 *      opens the other screen's film (as before);
 *  (d) v2 HAS edits of its own (written since it opened the film, or pending) and the other film keeps
 *      v2's cuts (the same owned part: aspect, cut list, trims, speed, volume, mute, frame data) → the
 *      other screen wrote around them (a caption, music, a reload of the current editor): v2 keeps its
 *      film and undo, shows the new captions and the rest, and writes what is pending onto it;
 *      otherwise another tab overwrote v2's cuts: v2 neither opens that film nor writes over it. It shows
 *      one bar with two choices, keep this screen's film (write it back) or open the other tab's film,
 *      and editing goes on meanwhile (nothing is written until a choice is made);
 *  (e) undo history is cleared only when a film is actually opened (the host does that in `open`).
 * An edit made while a film is being opened (item 8: the reload race) is never replaced by it: the open
 * is set aside and the film it brought is judged by (d).
 */
import { ownedSignature } from './stored';
import type { FrameSequence } from './frames';

export type FilmRead = { ok: true; text: string | null } | { ok: false };

export interface FilmSessionStore {
  read(): FilmRead;
  /** `false` when storage refused. */
  write(text: string): boolean;
}

export interface FilmSessionClock {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface FilmConflict {
  /** The film another tab wrote, as storage held it when the conflict was found. */
  text: string | null;
}

export interface FilmSessionHost {
  /**
   * Put this stored film on screen: measure, convert, replace the film, clear undo. When it is ready the
   * host calls `session.opened(ticket, sequence)` and applies it only if that answers `true`.
   */
  open(text: string | null, ticket: number): void;
  /** Storage now holds `text` and the cuts on screen are its cuts: show its other parts (captions…). */
  show(text: string | null): void;
  /** One plain bar with two choices, or `null` to take it down. */
  conflict(conflict: FilmConflict | null): void;
  /** Browser storage refused a read or a write: the film lives in memory for this visit. */
  storageFailed(): void;
}

export interface FilmSessionOptions {
  store: FilmSessionStore;
  clock: FilmSessionClock;
  host: FilmSessionHost;
  /** v2's cuts written onto the text storage holds now (stored.ts `mergeFilmText`, with the bin's clips). */
  merge(currentText: string | null, sequence: FrameSequence): string;
  /** Viewers and the studio team only look: nothing is ever written. */
  canEdit: boolean;
  saveDelayMs?: number;
  settleMs?: number;
}

/** How long after the last change the film is written. */
export const SAVE_DELAY_MS = 300;
/**
 * How long another screen's change must stay put before v2 reads it. The current editor writes its
 * empty film and then the real one inside one React commit (milliseconds apart); half a second leaves
 * room for a slow machine and is still well inside the time anyone needs to switch tabs.
 */
export const SETTLE_MS = 500;

export type Decision = 'same' | 'open' | 'around' | 'conflict';

export interface FilmSession {
  /** First read, then `host.open`. */
  start(): void;
  /** The host finished opening ticket `ticket`; apply it only on `true`. */
  opened(ticket: number, sequence: FrameSequence): boolean;
  /** The film on screen now (every local change, undo and redo included). */
  edited(sequence: FrameSequence): void;
  /** Write what is pending now (the page is being hidden or left). */
  flush(): void;
  /** Another screen wrote the key (a `storage` event): settle, then decide. */
  external(): void;
  /** The window got focus: a change made meanwhile is noticed even without an event. */
  focus(): void;
  /** Conflict choice: write this screen's film back. */
  keep(): void;
  /** Conflict choice: open the film the other tab wrote. */
  openOther(): void;
  /** Stop timers and write what is pending. */
  dispose(): void;
  /** For tests and the screen: what the session knows. */
  state(): { base: string | null | undefined; dirty: boolean; wrote: boolean; settling: boolean; opening: boolean; conflict: FilmConflict | null };
}

export function createFilmSession(options: FilmSessionOptions): FilmSession {
  const { store, clock, host, merge, canEdit } = options;
  const saveDelay = options.saveDelayMs ?? SAVE_DELAY_MS;
  const settleDelay = options.settleMs ?? SETTLE_MS;

  /** The text v2 last opened or wrote; `undefined` before the first open. */
  let base: string | null | undefined;
  /** The cuts storage holds, as v2 knows them (opened or written). */
  let saved: FrameSequence | null = null;
  /** The cuts on screen. */
  let current: FrameSequence | null = null;
  /** v2 wrote edits of its own since it last opened a film. */
  let wrote = false;
  let edits = 0;
  let ticket = 0;
  let opening: { ticket: number; text: string | null; edits: number } | null = null;
  let conflict: FilmConflict | null = null;
  let saveTimer: unknown = null;
  let settleTimer: unknown = null;
  let disposed = false;

  const dirty = () => canEdit && current !== null && current !== saved;
  const ownEdits = () => wrote || dirty();

  const cancelSave = () => {
    if (saveTimer !== null) clock.clear(saveTimer);
    saveTimer = null;
  };
  const scheduleSave = () => {
    cancelSave();
    if (disposed || !dirty() || conflict || opening || settleTimer !== null) return;
    saveTimer = clock.set(() => {
      saveTimer = null;
      flush();
    }, saveDelay);
  };

  const setConflict = (next: FilmConflict | null) => {
    if (conflict === next) return;
    conflict = next;
    host.conflict(next);
  };

  const openText = (text: string | null) => {
    cancelSave();
    ticket += 1;
    opening = { ticket, text, edits };
    host.open(text, ticket);
  };

  /** Writes v2's cuts onto `currentText` (what storage holds now). */
  const writeOnto = (currentText: string | null) => {
    if (!current || !canEdit) return;
    const text = merge(currentText, current);
    if (!store.write(text)) {
      host.storageFailed();
      return;
    }
    base = text;
    saved = current;
    wrote = true;
    host.show(text);
  };

  /** A film another screen wrote has settled in storage: what v2 does with it. */
  const decide = (text: string | null): Decision => {
    if (text === base) {
      // Storage holds exactly what v2 last opened or wrote: whatever was in the way is gone.
      setConflict(null);
      return 'same';
    }
    if (!ownEdits()) {
      setConflict(null);
      openText(text);
      return 'open';
    }
    if (base !== undefined && ownedSignature(text) === ownedSignature(base)) {
      base = text;
      setConflict(null);
      host.show(text);
      return 'around';
    }
    setConflict({ text });
    return 'conflict';
  };

  function flush() {
    cancelSave();
    if (!dirty() || conflict || opening) return;
    if (settleTimer !== null) {
      // Leaving while another screen's change settles: settle it now rather than write blindly.
      clock.clear(settleTimer);
      settleTimer = null;
      return settle();
    }
    const read = store.read();
    if (!read.ok) return host.storageFailed();
    if (read.text !== base && decide(read.text) !== 'around') return;
    writeOnto(read.text);
  }

  function settle() {
    settleTimer = null;
    const read = store.read();
    if (!read.ok) return host.storageFailed();
    const decision = decide(read.text);
    // An edit made while the change settled (item 8) is written now, onto the film that settled.
    if ((decision === 'same' || decision === 'around') && dirty()) writeOnto(read.text);
  }

  function external() {
    if (disposed) return;
    cancelSave();
    if (settleTimer !== null) clock.clear(settleTimer);
    settleTimer = clock.set(settle, settleDelay);
  }

  return {
    start() {
      const read = store.read();
      if (!read.ok) host.storageFailed();
      openText(read.ok ? read.text : null);
    },

    opened(forTicket, sequence) {
      if (!opening || opening.ticket !== forTicket) return false;
      const { text, edits: editsAtStart } = opening;
      opening = null;
      if (base !== undefined && edits !== editsAtStart && ownEdits()) {
        // Someone edited while this film was being opened: it must not replace their work.
        const decision = decide(text);
        if ((decision === 'same' || decision === 'around') && dirty()) scheduleSave();
        return false;
      }
      base = text;
      saved = sequence;
      current = sequence;
      wrote = false;
      setConflict(null);
      return true;
    },

    edited(sequence) {
      if (sequence === current) return;
      current = sequence;
      edits += 1;
      if (sequence === saved) return cancelSave();
      scheduleSave();
    },

    flush,

    external,

    focus() {
      if (disposed || settleTimer !== null) return;
      const read = store.read();
      if (read.ok && read.text !== base) external();
    },

    keep() {
      if (!conflict) return;
      const read = store.read();
      if (!read.ok) return host.storageFailed();
      setConflict(null);
      writeOnto(read.text);
    },

    openOther() {
      if (!conflict) return;
      const read = store.read();
      const text = read.ok ? read.text : conflict.text;
      setConflict(null);
      openText(text);
    },

    dispose() {
      if (settleTimer !== null) clock.clear(settleTimer);
      settleTimer = null;
      flush();
      cancelSave();
      disposed = true;
    },

    state() {
      return { base, dirty: dirty(), wrote, settling: settleTimer !== null, opening: opening !== null, conflict };
    },
  };
}
