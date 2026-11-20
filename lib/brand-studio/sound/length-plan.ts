/**
 * The length plan of a sung run (docs/BRAND-SOUND-STUDIO.md §12.11). Pure and client-safe: the dock, the lyrics
 * engine, the design and the request all use it, so the screen says what the server sends.
 *
 * Measured by the lead on 2026-11-21 (14 real requests, 28 songs, D:\dev\_backups\twings-sound-tests-20261120\
 * length-test-20261121): the engine builds a song in bars, not seconds. Fast songs landed on 8, 12 or 16 bars; one
 * sung line takes about 2.2 bars at 110 BPM and above (lower quartile; median 2.6) and 2.75 below 90 (median 3.4);
 * an instrumental section adds about 2.7. More syllables in the same lines are only sung faster. So the plan counts
 * lines and sections at a fixed tempo, and aims at "at least the chosen length": a long song can be cut later, a
 * short one cannot be stretched.
 *
 *  - Bars wanted: seconds × BPM / 240. Bars per line: 2.8 below 90 BPM, else 2.2; an instrumental section 2.2.
 *    Lines needed (sections counted in line-equivalents): ceil(bars / per line). 118 BPM: 15 s 4, 30 s 7, 60 s 14;
 *    78 BPM: 30 s 4, 60 s 7.
 *  - Stanzas hold 2 to 4 lines. A drafted hook is never padded with more words: an intro, a break after the first
 *    hook, the hook again, an empty outro, then another break and hook, until the lines are enough. The customer's
 *    own lyrics are never repeated by us: only sections are added, and the dock says when that is still short.
 *  - A line holds 7 to 10 syllables in Korean, 7 to 11 in English.
 */
import { defaultStructure, ownLyrics, structureMarks, tempoOf, type LyricStructure } from './lyrics';

export type TempoBand = 'fast' | 'mid' | 'slow';

/** The three tempo bands the lyrics engine picks from, each with the BPM it is planned at when only the band is known. */
export const TEMPO_BANDS: Readonly<Record<TempoBand, { from: number; to: number; bpm: number }>> = {
  fast: { from: 110, to: 160, bpm: 118 },
  mid: { from: 90, to: 109, bpm: 100 },
  slow: { from: 60, to: 89, bpm: 78 },
};

export function bandOf(bpm: number): TempoBand {
  return bpm >= 110 ? 'fast' : bpm >= 90 ? 'mid' : 'slow';
}

/** A tempo the plan accepts (from a model or a request): whole BPM in 60–160, else null. */
export function cleanBpm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const bpm = Math.round(n);
  return bpm >= 60 && bpm <= 160 ? bpm : null;
}

/** Bars one sung line takes: the lower quartile of the measurement (planning toward "at least"), and the median. */
export function barsPerLine(bpm: number): { plan: number; median: number } {
  return bpm < 90 ? { plan: 2.8, median: 3.4 } : { plan: 2.2, median: 2.6 };
}

export const SECTION_BARS = 2.2;
export const STANZA_LINES = { min: 2, max: 4 } as const;
export const LINE_SYLLABLES: Readonly<Record<'ko' | 'en', { min: number; max: number }>> = { ko: { min: 7, max: 10 }, en: { min: 7, max: 11 } };

export type SectionMark = '[Intro]' | '[Instrumental Break]' | '[Outro]';

/** One part of the sent form: a stanza (by its index in the lyrics, so a repeat points at the same one) or a section. */
export type FormPart = { kind: 'sung'; stanza: number; mark: string; repeat?: boolean } | { kind: 'section'; mark: SectionMark };

export interface LengthPlan {
  seconds: number | null;
  bpm: number;
  band: TempoBand;
  /** seconds × BPM / 240, one decimal. */
  targetBars: number;
  /** Line-equivalents wanted (sections included). */
  needed: number;
  /** Line-equivalents in the form. */
  units: number;
  form: FormPart[];
  /** The form reaches the target (always true without a length). */
  enough: boolean;
  /** Lines short of the target after every allowed section (0 when enough). */
  missingLines: number;
  /** Expected length in seconds, lower quartile to median of the measurement. */
  estimate: { min: number; max: number };
}

/** How many stanzas a drafted lyric has in each structure (the hook alone: one stanza, the rest is form). */
export const DRAFT_STANZAS: Readonly<Record<LyricStructure, number>> = { hook: 1, 'hook-verse': 4, full: 5 };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Line-equivalents wanted for a length at a tempo. */
export function linesNeeded(seconds: number, bpm: number): number {
  return Math.ceil((seconds * bpm) / 240 / barsPerLine(bpm).plan - 1e-9);
}

/** Lines per drafted stanza for a length: the lines needed spread over the structure's stanzas, 2 to 4 each. */
export function draftStanzaLines(structure: LyricStructure, seconds: number | null, bpm: number): number[] {
  const count = DRAFT_STANZAS[structure];
  const want = seconds ? linesNeeded(seconds, bpm) : count * 3;
  const clamp = (n: number) => Math.max(STANZA_LINES.min, Math.min(STANZA_LINES.max, n));
  const base = Math.floor(want / count);
  let extra = want - base * count;
  return Array.from({ length: count }, () => {
    const lines = clamp(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
    return lines;
  });
}

function sectionUnit(bpm: number): number {
  return SECTION_BARS / barsPerLine(bpm).plan;
}

/**
 * The form for lyrics already written: `stanzas` is the line count of each stanza in order. `repeatHook` lets the
 * plan sing the first hook again (drafted lyrics only; the customer's own lines are never repeated by us).
 */
export function lengthPlan(input: { seconds: number | null; bpm: number; structure: LyricStructure; stanzas: readonly number[]; repeatHook: boolean }): LengthPlan {
  const bpm = input.bpm;
  const marks = structureMarks(input.structure, input.stanzas.length);
  const sung: FormPart[] = input.stanzas.map((_, i) => ({ kind: 'sung', stanza: i, mark: marks[i]! }));
  const per = barsPerLine(bpm);
  const unit = sectionUnit(bpm);
  const needed = input.seconds ? linesNeeded(input.seconds, bpm) : 0;

  let intro = false;
  let outro = false;
  /** Breaks after stanza i, and (one-stanza hook only) how many times the hook is sung again. */
  const breaksAfter = new Set<number>();
  let repeats = 0;
  const hasSungOutro = marks[marks.length - 1] === '[Outro]';
  // Only a drafted "후크만" is repeated: the other structures reach 60 s with their own lines (5 x 4 = 20).
  const canRepeat = input.repeatHook && input.stanzas.length === 1;

  const build = (): FormPart[] => {
    const out: FormPart[] = [];
    if (intro) out.push({ kind: 'section', mark: '[Intro]' });
    sung.forEach((part, i) => {
      out.push(part);
      if (breaksAfter.has(i)) out.push({ kind: 'section', mark: '[Instrumental Break]' });
      if (i === 0) {
        for (let r = 0; r < repeats; r += 1) {
          if (r > 0) out.push({ kind: 'section', mark: '[Instrumental Break]' });
          out.push({ kind: 'sung', stanza: 0, mark: part.mark, repeat: true });
        }
      }
    });
    if (outro) out.push({ kind: 'section', mark: '[Outro]' });
    return out;
  };
  const unitsOf = (form: readonly FormPart[]) =>
    form.reduce((sum, part) => sum + (part.kind === 'section' ? unit : input.stanzas[part.stanza] ?? 0), 0);

  // The padding steps, in order (§12.11): intro, a break after the first stanza, the hook again, an empty outro,
  // then breaks after later stanzas, then (hook) one more break and hook. Each is taken only while still short.
  const steps: Array<() => boolean> = [
    () => (intro ? false : ((intro = true), true)),
    () => (sung.length && !breaksAfter.has(0) ? (breaksAfter.add(0), true) : false),
    () => (canRepeat && repeats === 0 ? ((repeats = 1), true) : false),
    () => (!hasSungOutro && !outro ? ((outro = true), true) : false),
  ];
  for (let i = 1; i < sung.length - 1; i += 1) steps.push(() => (breaksAfter.has(i) ? false : (breaksAfter.add(i), true)));
  if (canRepeat) steps.push(() => (repeats === 1 ? ((repeats = 2), true) : false));

  let form = build();
  if (input.seconds) {
    for (const step of steps) {
      if (unitsOf(form) >= needed) break;
      if (step()) form = build();
    }
  }
  const units = round1(unitsOf(form));
  const lines = form.reduce((sum, part) => sum + (part.kind === 'sung' ? input.stanzas[part.stanza] ?? 0 : 0), 0);
  const sections = form.filter((part) => part.kind === 'section').length;
  const seconds = (barsLine: number) => Math.round(((lines * barsLine + sections * SECTION_BARS) * 240) / bpm);
  const enough = !input.seconds || unitsOf(form) >= needed - 1e-9;
  return {
    seconds: input.seconds,
    bpm,
    band: bandOf(bpm),
    targetBars: input.seconds ? round1((input.seconds * bpm) / 240) : 0,
    needed,
    units,
    form,
    enough,
    missingLines: enough ? 0 : Math.ceil(needed - unitsOf(form) - 1e-9),
    estimate: { min: seconds(per.plan), max: seconds(per.median) },
  };
}

/** The stanzas of plain lyrics (blank lines separate them): line counts, mark lines not counted. */
export function stanzaLines(lyrics: string): number[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').filter((line) => line.trim() && !/^\s*\[[^\]\n]{1,40}\]\s*$/.test(line)).length)
    .filter((n) => n > 0);
}

/** The form as marks, for the run's record and the eval ("[Intro] [Chorus] [Instrumental Break] [Chorus]*"). */
export function formText(form: readonly FormPart[]): string {
  return form.map((part) => (part.kind === 'sung' && part.repeat ? `${part.mark}*` : part.mark)).join(' ');
}

/**
 * The tempo a sung run is planned at, decided once before anything is sized or designed: a BPM written in the
 * description, else the tempo the lyrics engine chose for a draft, else the words (fast or slow), else the mid band.
 */
export function runTempo(input: { description: string; draftBpm?: number | null; wordsBpm?: number | null }): number {
  const written = /(\d{2,3})\s*bpm/i.exec(input.description);
  return cleanBpm(written?.[1]) ?? cleanBpm(input.draftBpm) ?? cleanBpm(input.wordsBpm) ?? TEMPO_BANDS.mid.bpm;
}

/** Syllables in one sung line: Hangul syllables, or vowel groups for Latin words (a rough English count). */
export function lineSyllables(line: string): number {
  const hangul = (line.match(/[가-힣]/g) ?? []).length;
  const latin = line
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, word) => {
      const groups = word.replace(/e$/, '').match(/[aeiouy]+/g)?.length ?? 0;
      return sum + Math.max(1, groups);
    }, 0);
  return hangul + latin;
}

/** What a sung run keeps of its plan (`params.music.plan`): enough to send it again and to fit the numbers later. */
export interface RunPlanRecord {
  bpm: number;
  band: TempoBand;
  seconds: number | null;
  targetBars: number;
  needed: number;
  units: number;
  enough: boolean;
  estimate: { min: number; max: number };
  form: FormPart[];
}

export function planRecord(plan: RunPlanRecord): RunPlanRecord {
  const { bpm, band, seconds, targetBars, needed, units, enough, estimate, form } = plan;
  return { bpm, band, seconds, targetBars, needed, units, enough, estimate, form };
}

/**
 * The plan of a sung run, the same on the dock and the server: the tempo decided once (`runTempo`: a written BPM,
 * the draft's, the words', the mid band), the lines as written, sections around them, and the hook sung again only
 * when it was drafted (`drafted`). Null without vocals, lyrics or a length. Lyrics with marks of their own keep their form.
 */
export function sungPlan(input: {
  prompt: string;
  vocal: boolean;
  lyrics: string | null | undefined;
  structure: LyricStructure | null | undefined;
  seconds: number | null | undefined;
  draftBpm?: number | null;
  drafted: boolean;
}): LengthPlan | null {
  const text = ownLyrics(input.lyrics);
  const seconds = input.seconds ?? null;
  // Without a length there is nothing to plan: the lyrics go as written and the design picks the tempo (as before).
  if (!input.vocal || !text.trim() || !seconds) return null;
  const bpm = runTempo({ description: input.prompt, draftBpm: input.draftBpm ?? null, wordsBpm: tempoOf(input.prompt) });
  const ownMarks = /^\s*\[[^\]\n]{1,40}\]\s*$/m.test(text);
  return lengthPlan({
    seconds: ownMarks ? null : seconds,
    bpm,
    structure: input.structure ?? defaultStructure(seconds),
    stanzas: stanzaLines(text),
    repeatHook: input.drafted,
  });
}

const PHRASE: Readonly<Record<string, string>> = {
  '[Intro]': 'a four-bar instrumental intro',
  '[Instrumental Break]': 'an instrumental break',
  '[Outro]': 'an instrumental outro',
};

/** The form as one English sentence for the style paragraph (the fallback design adds it; the model is told it). */
export function formSentence(plan: Pick<LengthPlan, 'bpm' | 'form'>): string {
  let hookSung = false;
  const parts = plan.form.map((part) => {
    if (part.kind === 'section') return PHRASE[part.mark]!;
    if (part.mark === '[Chorus]') {
      const phrase = hookSung || part.repeat ? 'the hook again' : 'the hook';
      hookSung = true;
      return phrase;
    }
    if (part.mark === '[Outro]') return 'a short sung outro';
    if (part.mark === '[Bridge]') return 'a bridge';
    return 'a verse';
  });
  return `Around ${plan.bpm} BPM. The form, in order: ${parts.join(', then ')}.`;
}

/** True when the form opens on an instrumental intro (the style must not say it drops straight into the hook). */
export function opensOnIntro(form: readonly FormPart[]): boolean {
  return form[0]?.kind === 'section' && form[0].mark === '[Intro]';
}
