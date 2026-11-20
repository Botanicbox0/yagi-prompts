import { describe, expect, it } from 'vitest';
import {
  emptyComposerProject,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposeClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { createFilmSession, SAVE_DELAY_MS, SETTLE_MS, type FilmConflict, type FilmSessionOptions } from '@/lib/brand-studio/editor-v2/film-session';
import { removeClips, splitAtFrame, trimClipEdge, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { fromStored, mergeFilmText, ownedSignature } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Review round 1, items 7 and 8: v2's persistence, without React. A tab of the current editor that has
 * been open since before v2's edits must not silently wipe them; a freshly opened one writes an empty
 * film first; an edit made while another screen's change settles (or while a film is being opened) is
 * never lost. Fake storage and a fake clock; the merge is the real stored-film bridge.
 */
const SRC_A = '/api/brand-studio/compose?organizationId=org&source=asset&id=a';
const SRC_B = '/api/brand-studio/compose?organizationId=org&source=asset&id=b';
const MEASURED = { [SRC_A]: { fps: 24, frames: 240 }, [SRC_B]: { fps: 24, frames: 240 } };

function clip(id: string, srcUrl: string, extra: Partial<ComposeClip> = {}): ComposeClip {
  return { id, label: id, sourceKind: 'asset', assetId: id, srcUrl, thumbUrl: null, durationSec: 10, trimStartSec: 0, trimEndSec: 4, volume: 1, muted: false, ...extra };
}

/** The film the current editor made: two clips and a caption. */
const FILM: ComposerProject = parseStoredProject(
  JSON.stringify({
    ...emptyComposerProject('9:16'),
    clips: [clip('c1', SRC_A), clip('c2', SRC_B, { trimStartSec: 1, trimEndSec: 5 })],
    captions: [{ id: 'k', text: 'hello', startSec: 0.5, endSec: 2, position: 'bottom', size: 'md' }],
  }),
)!;
const FILM_TEXT = serializeProjectForStorage(FILM);
/** What a mounting current editor writes first. */
const EMPTY_TEXT = serializeProjectForStorage(emptyComposerProject('9:16'));

const cutsOf = (text: string | null): FrameSequence => ({ ...fromStored(parseStoredProject(text) ?? emptyComposerProject('9:16'), MEASURED).sequence, captions: [] });

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    clock: {
      set: (run: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { at: now + ms, run });
        return id;
      },
      clear: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

function setup(initial: string | null = FILM_TEXT, overrides: Partial<FilmSessionOptions> = {}) {
  const storage = { text: initial, ok: true };
  const writes: string[] = [];
  const opens: Array<{ text: string | null; ticket: number }> = [];
  const shows: Array<string | null> = [];
  const conflicts: Array<FilmConflict | null> = [];
  let failures = 0;
  const time = fakeClock();
  const merges: Array<string | null> = [];
  const session = createFilmSession({
    store: {
      read: () => (storage.ok ? { ok: true, text: storage.text } : { ok: false }),
      write: (text) => {
        if (!storage.ok) return false;
        storage.text = text;
        writes.push(text);
        return true;
      },
    },
    clock: time.clock,
    host: {
      open: (text, ticket) => opens.push({ text, ticket }),
      show: (text) => shows.push(text),
      conflict: (c) => conflicts.push(c),
      storageFailed: () => {
        failures += 1;
      },
    },
    merge: (text, sequence) => {
      merges.push(text);
      return mergeFilmText(text, sequence);
    },
    canEdit: true,
    ...overrides,
  });
  /** What the host does when it finishes opening: convert and apply when the session agrees. */
  const finishOpen = () => {
    const last = opens[opens.length - 1]!;
    const sequence = cutsOf(last.text);
    const applied = session.opened(last.ticket, sequence);
    if (applied) session.edited(sequence);
    return { applied, sequence };
  };
  /** Another tab writes the key and the browser tells this tab. */
  const otherTab = (text: string) => {
    storage.text = text;
    session.external();
  };
  return { storage, writes, opens, shows, conflicts, failures: () => failures, time, session, finishOpen, otherTab, merges };
}

/** The film v2 shows after one of its own edits (a split at frame 30, then a one-frame trim). */
const edit = (sequence: FrameSequence) => trimClipEdge(splitAtFrame(sequence, 30, `cut-${sequence.clips.length}`), 0, 'end', -1).seq;

describe('opening', () => {
  it('reads the key once and opens it; nothing is written by opening', () => {
    const t = setup();
    t.session.start();
    expect(t.opens).toEqual([{ text: FILM_TEXT, ticket: 1 }]);
    expect(t.finishOpen().applied).toBe(true);
    t.time.advance(10_000);
    expect(t.writes).toEqual([]);
    expect(t.session.state()).toMatchObject({ base: FILM_TEXT, dirty: false, wrote: false });
  });

  it('without browser storage it says so once and opens an empty film', () => {
    const t = setup();
    t.storage.ok = false;
    t.session.start();
    expect(t.failures()).toBe(1);
    expect(t.opens).toEqual([{ text: null, ticket: 1 }]);
  });
});

describe('writing v2’s own edits', () => {
  it('edit → a pause → read, merge, write onto what the key holds then', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    const edited = edit(sequence);
    t.session.edited(edited);
    t.time.advance(SAVE_DELAY_MS - 1);
    expect(t.writes).toEqual([]);
    // The sound studio added music meanwhile (no event reached this tab yet): it is kept.
    const withMusic = serializeProjectForStorage({ ...FILM, bgm: { label: 'm', sourceKind: 'asset', assetId: 'm', srcUrl: '/m.mp3', durationSec: 30, trimStartSec: 0, volume: 0.5 } });
    t.storage.text = withMusic;
    t.time.advance(1);
    expect(t.writes).toHaveLength(1);
    expect(t.merges).toEqual([withMusic]);
    const written = parseStoredProject(t.writes[0]!)!;
    expect(written.bgm?.label).toBe('m');
    expect(written.captions).toEqual(FILM.captions);
    expect(ownedSignature(t.writes[0]!)).toBe(ownedSignature(mergeFilmText(FILM_TEXT, edited)));
    expect(t.session.state()).toMatchObject({ dirty: false, wrote: true });
  });

  it('many quick edits are one write; undo back to what is stored writes nothing', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    const once = edit(sequence);
    t.session.edited(once);
    t.time.advance(100);
    t.session.edited(edit(once));
    t.time.advance(100);
    t.session.edited(sequence); // undo, twice
    t.time.advance(10_000);
    expect(t.writes).toEqual([]);
  });

  it('the page being hidden writes at once', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    t.session.edited(edit(sequence));
    t.session.flush();
    expect(t.writes).toHaveLength(1);
    t.time.advance(10_000);
    expect(t.writes).toHaveLength(1);
  });

  it('viewers never write', () => {
    const t = setup(FILM_TEXT, { canEdit: false });
    t.session.start();
    const { sequence } = t.finishOpen();
    t.session.edited(edit(sequence));
    t.session.flush();
    t.time.advance(10_000);
    expect(t.writes).toEqual([]);
  });

  it('a write storage refuses is said once per refusal and never throws', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    t.storage.ok = false;
    t.session.edited(edit(sequence));
    expect(() => t.time.advance(SAVE_DELAY_MS)).not.toThrow();
    expect(t.failures()).toBe(1);
  });
});

describe('another screen changes the film', () => {
  it('no edits of v2’s own: it opens the other film, once it has settled', () => {
    const t = setup();
    t.session.start();
    t.finishOpen();
    const other = serializeProjectForStorage({ ...FILM, clips: [FILM.clips[1]!] });
    t.otherTab(other);
    t.time.advance(SETTLE_MS - 1);
    expect(t.opens).toHaveLength(1);
    t.time.advance(1);
    expect(t.opens.at(-1)).toEqual({ text: other, ticket: 2 });
    expect(t.finishOpen().applied).toBe(true);
    expect(t.session.state()).toMatchObject({ base: other, wrote: false });
    expect(t.writes).toEqual([]);
  });

  it('a mounting current editor writes an empty film and then the real one: only the real one is read', () => {
    const t = setup();
    t.session.start();
    t.finishOpen();
    const real = serializeProjectForStorage({ ...FILM, captions: [] }); // the other tab removed the caption
    t.otherTab(EMPTY_TEXT);
    t.time.advance(30);
    t.otherTab(real);
    t.time.advance(SETTLE_MS);
    expect(t.opens.map((o) => o.text)).toEqual([FILM_TEXT, real]);
    expect(t.opens.some((o) => o.text === EMPTY_TEXT)).toBe(false);
  });

  it('…and with v2’s own edits written, the remount (empty, then v2’s own film) costs nothing: no bar, no open, no write', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    t.session.edited(edit(sequence));
    t.time.advance(SAVE_DELAY_MS);
    const mine = t.storage.text!;
    t.otherTab(EMPTY_TEXT);
    t.time.advance(40);
    // The current editor loads what v2 wrote and writes it back in its own format.
    t.otherTab(serializeProjectForStorage(parseStoredProject(mine)!));
    t.time.advance(SETTLE_MS);
    expect(t.conflicts.filter(Boolean)).toEqual([]);
    expect(t.opens).toHaveLength(1);
    expect(t.writes).toHaveLength(1);
    expect(ownedSignature(t.storage.text)).toBe(ownedSignature(mine));
  });

  it('an edit made while the empty film sits there is held, then written onto the real film (never onto the empty one)', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    t.otherTab(EMPTY_TEXT);
    t.session.edited(edit(sequence));
    t.time.advance(SAVE_DELAY_MS + 10); // the save timer would have fired: it must not write onto the empty film
    expect(t.writes).toEqual([]);
    t.otherTab(FILM_TEXT); // the real film arrives
    t.time.advance(SETTLE_MS);
    expect(t.writes).toHaveLength(1);
    expect(parseStoredProject(t.writes[0]!)!.captions).toEqual(FILM.captions);
    expect(t.conflicts.filter(Boolean)).toEqual([]);
  });

  it('a change around v2’s cuts (a caption, music) after v2’s edits: v2 keeps its film and undo, shows the new parts', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    t.session.edited(edit(sequence));
    t.time.advance(SAVE_DELAY_MS);
    const mine = parseStoredProject(t.storage.text!)!;
    const around = serializeProjectForStorage({ ...mine, captions: [...mine.captions, { id: 'k2', text: 'more', startSec: 3, endSec: 4, position: 'top', size: 'sm' }] });
    t.otherTab(around);
    t.time.advance(SETTLE_MS);
    expect(t.opens).toHaveLength(1);
    expect(t.conflicts.filter(Boolean)).toEqual([]);
    expect(t.shows.at(-1)).toBe(around);
    expect(t.session.state().base).toBe(around);
  });
});

describe('a stale tab of the current editor overwrites v2’s work', () => {
  function overwritten() {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    const mine = edit(sequence);
    t.session.edited(mine);
    t.time.advance(SAVE_DELAY_MS);
    const written = t.storage.text!;
    // The stale tab still holds FILM; it changes something (mutes the second clip) and writes its whole film.
    const stale = serializeProjectForStorage({ ...FILM, clips: [FILM.clips[0]!, { ...FILM.clips[1]!, muted: true }] });
    t.otherTab(stale);
    t.time.advance(SETTLE_MS);
    return { t, mine, written, stale };
  }

  it('v2 neither opens it nor writes over it: one bar with the other film', () => {
    const { t, stale } = overwritten();
    expect(t.conflicts.at(-1)).toEqual({ text: stale });
    expect(t.opens).toHaveLength(1);
    expect(t.writes).toHaveLength(1);
    expect(t.storage.text).toBe(stale);
  });

  it('editing goes on meanwhile and nothing is written until a choice is made', () => {
    const { t, mine } = overwritten();
    t.session.edited(edit(mine));
    t.time.advance(10_000);
    t.session.flush();
    expect(t.writes).toHaveLength(1);
    expect(t.session.state()).toMatchObject({ dirty: true });
  });

  it('“keep this screen’s film” writes v2’s cuts back onto what is there, keeping the rest', () => {
    const { t, mine, stale } = overwritten();
    const further = edit(mine);
    t.session.edited(further);
    t.session.keep();
    expect(t.conflicts.at(-1)).toBeNull();
    expect(t.writes).toHaveLength(2);
    expect(t.merges.at(-1)).toBe(stale);
    expect(ownedSignature(t.storage.text)).toBe(ownedSignature(mergeFilmText(stale, further)));
    expect(t.session.state()).toMatchObject({ dirty: false, conflict: null });
  });

  it('“open the other tab’s film” opens it (undo starts over there) and writes nothing', () => {
    const { t, stale } = overwritten();
    t.session.openOther();
    expect(t.conflicts.at(-1)).toBeNull();
    expect(t.opens.at(-1)?.text).toBe(stale);
    expect(t.finishOpen().applied).toBe(true);
    expect(t.writes).toHaveLength(1);
    expect(t.session.state()).toMatchObject({ base: stale, wrote: false, dirty: false });
  });

  it('the bar goes away by itself when the other tab puts v2’s cuts back', () => {
    const { t, written } = overwritten();
    t.otherTab(written);
    t.time.advance(SETTLE_MS);
    expect(t.conflicts.at(-1)).toBeNull();
  });
});

describe('item 8: an edit made during an external reload is not lost', () => {
  it('edited while the change settles: the other film is not opened over it', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    const other = serializeProjectForStorage({ ...FILM, clips: [FILM.clips[1]!] });
    t.otherTab(other);
    t.time.advance(SETTLE_MS / 2);
    t.session.edited(edit(sequence));
    t.time.advance(SETTLE_MS);
    expect(t.opens).toHaveLength(1); // not reopened over the edit
    expect(t.conflicts.at(-1)).toEqual({ text: other });
    t.session.keep();
    expect(ownedSignature(t.storage.text)).toBe(ownedSignature(mergeFilmText(other, edit(sequence))));
  });

  it('edited while the other film is being opened (measured): the open is set aside', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    const other = serializeProjectForStorage({ ...FILM, clips: [FILM.clips[1]!] });
    t.otherTab(other);
    t.time.advance(SETTLE_MS);
    expect(t.opens.at(-1)?.text).toBe(other); // opening has begun
    t.session.edited(edit(sequence)); // the person cuts while it measures
    expect(t.finishOpen().applied).toBe(false);
    expect(t.conflicts.at(-1)).toEqual({ text: other });
    expect(t.session.state().dirty).toBe(true);
  });

  it('edited while a change around the cuts settles: written onto it, music kept', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    const withMusic = serializeProjectForStorage({ ...FILM, bgm: { label: 'm', sourceKind: 'asset', assetId: 'm', srcUrl: '/m.mp3', durationSec: 30, trimStartSec: 0, volume: 0.5 } });
    t.otherTab(withMusic);
    t.session.edited(edit(sequence));
    t.time.advance(SETTLE_MS);
    expect(t.writes).toHaveLength(1);
    const written = parseStoredProject(t.writes[0]!)!;
    expect(written.bgm?.label).toBe('m');
    expect(ownedSignature(t.writes[0]!)).toBe(ownedSignature(mergeFilmText(FILM_TEXT, edit(sequence))));
  });

  it('the page hidden while a change settles: it is settled at once, never written blindly', () => {
    const t = setup();
    t.session.start();
    const { sequence } = t.finishOpen();
    t.session.edited(edit(sequence));
    t.time.advance(SAVE_DELAY_MS);
    t.session.edited(removeClips(edit(sequence), ['c1']));
    t.otherTab(EMPTY_TEXT); // a remount caught halfway
    t.session.flush();
    expect(t.writes).toHaveLength(1); // not onto the empty film
    expect(t.conflicts.at(-1)).toEqual({ text: EMPTY_TEXT });
  });
});

describe('focus', () => {
  it('notices a change made while this tab was away, through the same settle', () => {
    const t = setup();
    t.session.start();
    t.finishOpen();
    const other = serializeProjectForStorage({ ...FILM, clips: [FILM.clips[0]!] });
    t.storage.text = other; // no event reached this tab
    t.session.focus();
    t.time.advance(SETTLE_MS);
    expect(t.opens.at(-1)?.text).toBe(other);
    t.finishOpen();
    t.session.focus(); // nothing new
    t.time.advance(SETTLE_MS);
    expect(t.opens).toHaveLength(2);
  });
});
