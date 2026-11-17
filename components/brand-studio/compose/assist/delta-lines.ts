/**
 * Words for "말로 편집" (docs/BRAND-EDITING-STUDIO.md §4.6): every sentence the panel shows comes from the
 * dictionary (`messages/studio-compose.ts` → `assist`), filled with values from the timeline diff
 * (`EditDelta`), a question kind, a choice value or a note code. No model text reaches the screen.
 *
 * Pure and client-safe.
 */
import { fill } from '@/components/brand-studio/copy';
import type { ComposerProject, ComposeColorPresetId } from '@/lib/brand-studio/compose';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import type { AskAbout, AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import type { StudioComposeCopy } from '@/messages/studio-compose';
import type { AssistNoteCode } from './assist-model';

export type AssistWordsCopy = Pick<StudioComposeCopy, 'assist' | 'colorGrade' | 'chat' | 'timeline'>;
export type DeltaLineKey = keyof StudioComposeCopy['assist']['lines'];

/** One change line before wording: the dictionary key and the values for its placeholders. */
export interface DeltaLine {
  key: DeltaLineKey;
  values: Record<string, string | number>;
}

/** Caption text inside a change line is cut here so one long caption cannot fill the panel. */
export const LINE_CAPTION_MAX = 28;
/** Caption text on an answer chip. */
export const CHOICE_CAPTION_MAX = 16;

/** Seconds as people say them: "4", "2.5" (one decimal only when needed). */
export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Trims and cuts a text to `max` characters (by code point), ending with "…" when it was cut. */
export function shortenText(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : chars.join('');
}

/** The name the colour panel shows for a preset. */
export function presetName(copy: Pick<StudioComposeCopy, 'colorGrade'>, presetId: ComposeColorPresetId): string {
  switch (presetId) {
    case 'twings-french-blue':
      return copy.colorGrade.presets.frenchBlue;
    case 'clean-high-key':
      return copy.colorGrade.presets.cleanHighKey;
    case 'editorial-cool-porcelain':
      return copy.colorGrade.presets.coolPorcelain;
    case 'kodak-2383-warm':
      return copy.colorGrade.presets.filmWarm;
    case 'moody-teal-amber':
      return copy.colorGrade.presets.tealAmber;
    case 'pastel-airy-film':
      return copy.colorGrade.presets.pastelAiry;
  }
}

/** `EditDelta` → dictionary key + values. Every delta kind has a line. */
export function deltaLine(delta: EditDelta, copy: Pick<StudioComposeCopy, 'assist' | 'colorGrade'>): DeltaLine {
  switch (delta.kind) {
    case 'clip_removed':
      return { key: 'clipRemoved', values: { n: delta.cut } };
    case 'clip_split':
      return { key: 'clipSplit', values: { n: delta.cut, at: formatSeconds(delta.atSec) } };
    case 'clip_trimmed':
      return {
        key: 'clipTrimmed',
        values: { n: delta.cut, before: formatSeconds(delta.beforeSec), after: formatSeconds(delta.afterSec) },
      };
    case 'clip_moved':
      return { key: 'clipMoved', values: { n: delta.cut, to: delta.toPosition } };
    case 'clip_sound': {
      const all = delta.cut === 'all';
      const cut: Record<string, number> = delta.cut === 'all' ? {} : { n: delta.cut };
      if (delta.muted === true) return { key: all ? 'allMuted' : 'clipMuted', values: cut };
      if (delta.volumePct !== undefined) return { key: all ? 'allVolume' : 'clipVolume', values: { ...cut, pct: delta.volumePct } };
      return { key: all ? 'allUnmuted' : 'clipUnmuted', values: cut };
    }
    case 'caption_removed':
      return { key: 'captionRemoved', values: { text: shortenText(delta.text, LINE_CAPTION_MAX) } };
    case 'caption_changed':
      return { key: 'captionChanged', values: { text: shortenText(delta.text, LINE_CAPTION_MAX) } };
    case 'caption_added':
      return {
        key: 'captionAdded',
        values: {
          text: shortenText(delta.text, LINE_CAPTION_MAX),
          from: formatSeconds(delta.fromSec),
          to: formatSeconds(delta.toSec),
        },
      };
    case 'music_removed':
      return { key: 'musicRemoved', values: {} };
    case 'music_volume':
      return { key: 'musicVolume', values: { before: delta.beforePct, after: delta.afterPct } };
    case 'aspect':
      return { key: 'aspect', values: { before: delta.before, after: delta.after } };
    case 'look': {
      if (delta.preset === 'off') return { key: 'lookOff', values: {} };
      const name = delta.preset === 'custom' ? copy.assist.lines.lookCustom : presetName(copy, delta.preset);
      return delta.strengthPct !== undefined
        ? { key: 'lookStrength', values: { name, pct: delta.strengthPct } }
        : { key: 'look', values: { name } };
    }
    case 'other':
      return { key: 'other', values: { count: delta.count } };
    case 'total':
      return {
        key: 'total',
        values: { before: formatSeconds(delta.beforeSec), after: formatSeconds(delta.afterSec) },
      };
  }
}

export function lineText(line: DeltaLine, copy: Pick<StudioComposeCopy, 'assist'>): string {
  return fill(copy.assist.lines[line.key], line.values);
}

export function deltaText(delta: EditDelta, copy: Pick<StudioComposeCopy, 'assist' | 'colorGrade'>): string {
  return lineText(deltaLine(delta, copy), copy);
}

/** The question for an `ask`, by what it is about. */
export function askQuestion(about: AskAbout, copy: Pick<StudioComposeCopy, 'assist'>): string {
  switch (about) {
    case 'which_clip':
      return copy.assist.ask.whichClip;
    case 'which_caption':
      return copy.assist.ask.whichCaption;
    case 'how_long':
      return copy.assist.ask.howLong;
    case 'where_caption':
      return copy.assist.ask.whereCaption;
  }
}

/**
 * The label of one answer chip: a cut by its CURRENT position ("2번 컷"), every cut, seconds, a caption by
 * its (shortened) text, or a place. `null` when the cut or caption is no longer on the timeline.
 */
export function askChoiceText(
  choice: AskChoice,
  project: ComposerProject,
  copy: Pick<StudioComposeCopy, 'assist'>,
): string | null {
  const ask = copy.assist.ask;
  if (choice === 'all') return ask.choiceAll;
  if (choice === 'start') return ask.choiceStart;
  if (choice === 'end') return ask.choiceEnd;
  if (choice === 'whole') return ask.choiceWhole;
  if (typeof choice === 'number') return fill(ask.choiceSeconds, { n: formatSeconds(choice) });
  if ('clipId' in choice) {
    const index = project.clips.findIndex((clip) => clip.id === choice.clipId);
    return index < 0 ? null : fill(ask.choiceClip, { n: index + 1 });
  }
  const caption = project.captions.find((c) => c.id === choice.captionId);
  return caption ? fill(ask.choiceCaption, { text: shortenText(caption.text, CHOICE_CAPTION_MAX) }) : null;
}

/**
 * One line for a note. Undo and "nothing to undo" reuse the chat panel's sentences, "no scene change
 * found" the timeline's own (the same sentence the scene-cut button shows).
 */
export function noteText(code: AssistNoteCode, copy: AssistWordsCopy, seconds?: number): string {
  const notes = copy.assist.notes;
  switch (code) {
    case 'no_change':
      return notes.noChange;
    case 'no_cuts_found':
      return copy.timeline.noCutsDetected;
    case 'stale':
      return notes.stale;
    case 'not_timeline_edit':
      return notes.notTimelineEdit;
    case 'nothing_to_edit':
      return notes.nothingToEdit;
    case 'not_possible':
      return notes.notPossible;
    case 'could_not_plan':
      return notes.couldNotPlan;
    case 'unavailable':
      return notes.unavailable;
    case 'rate_limited':
      return fill(notes.rateLimited, { seconds: seconds ?? 60 });
    case 'undone':
      return copy.chat.undone;
    case 'nothing_to_undo':
      return copy.chat.nothingToUndo;
  }
}
