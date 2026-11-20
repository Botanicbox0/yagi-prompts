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
 *  - Bars wanted: seconds × BPM / 240. A sung line is planned at 2.5 bars (2.8 below 90 BPM) and a section at 2.7:
 *    with these, the forms that reached the length in the measurement (30 s: 7 lines, 3 lines with intro, break
 *    and empty outro, the hook twice; 60 s: intro, hook, break, hook again, break, 2-line outro) count as enough,
 *    and the forms that came back short (3 lines alone) do not. The expected length runs from the lower quartile
 *    (2.2 or 2.75 a line, 2.2 a section) to the median (2.6 or 3.4 a line, 2.7 a section).
 *  - Stanzas hold 2 to 4 lines, a line 7 to 10 syllables in Korean, 7 to 11 in English.
 *  - Filling, in order, each step only while the form is short: an intro, an empty outro (the song never ends on a
 *    break), a break after the first stanza, then for a drafted hook the hook again (with a break before a sung
 *    outro), then breaks after later stanzas. A drafted hook that needs more than one stanza with all of that gets a
 *    2-line sung outro as its second stanza. The customer's own lines are never repeated by us.
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

/** Bars one sung line takes: what the plan counts, and the measurement's lower quartile and median. */
export function barsPerLine(bpm: number): { plan: number; low: number; median: number } {
  return bpm < 90 ? { plan: 2.8, low: 2.75, median: 3.4 } : { plan: 2.5, low: 2.2, median: 2.6 };
}

/** Bars one instrumental section takes: planned and median about 2.7 (measured), 2.2 for the low estimate. */
export const SECTION_BARS = { plan: 2.7, low: 2.2, median: 2.7 } as const;
export const STANZA_LINES = { min: 2, max: 4 } as const;
export const LINE_SYLLABLES: Readonly<Record<'ko' | 'en', { min: number; max: number }>> = { ko: { min: 7, max: 10 }, en: { min: 7, max: 11 } };
/** The expected median over the chosen length above which the dock says the song will run long. */
export const LONG_RATIO = 1.45;

export type SectionMark = '[Intro]' | '[Instrumental Break]' | '[Outro]';

/** One part of the sent form: a stanza (by its index in the lyrics, so a repeat points at the same one) or a section. */
export type FormPart = { kind: 'sung'; stanza: number; mark: string; repeat?: boolean } | { kind: 'section'; mark: SectionMark };

export interface LengthPlan {
  seconds: number | null;
  bpm: number;
  band: TempoBand;
  /** seconds × BPM / 240, one decimal. */
  targetBars: number;
  /** Bars the form is planned to fill, one decimal. */
  bars: number;
  /** Lines the length wants at the planned bars a line (without sections). */
  needed: number;
  form: FormPart[];
  /** The form reaches the target (always true without a length). */
  enough: boolean;
  /** Lines short of the target after every allowed section (0 when enough). */
  missingLines: number;
  /** Expected length in seconds, lower quartile to median of the measurement. */
  estimate: { min: number; max: number };
}

/** How many stanzas a drafted lyric has in each structure without a length (the hook alone: one stanza). */
export const DRAFT_STANZAS: Readonly<Record<LyricStructure, number>> = { hook: 1, 'hook-verse': 4, full: 5 };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function targetBarsOf(seconds: number, bpm: number): number {
  return (seconds * bpm) / 240;
}

/** Lines a length wants at a tempo, sections aside. */
export function linesNeeded(seconds: number, bpm: number): number {
  return Math.ceil(targetBarsOf(seconds, bpm) / barsPerLine(bpm).plan - 1e-9);
}

const clampLines = (n: number) => Math.max(STANZA_LINES.min, Math.min(STANZA_LINES.max, n));

/**
 * Lines per drafted stanza for a length. The hook: one stanza of up to 4 lines, filled with sections and a repeat;
 * when that is not enough (or a 2-line outro reaches the length without a repeat) a 2-line sung outro joins it.
 * The other structures spread the lines the length wants over their stanzas, 2 to 4 each.
 */
export function draftStanzaLines(structure: LyricStructure, seconds: number | null, bpm: number): number[] {
  if (!seconds) return Array.from({ length: DRAFT_STANZAS[structure] }, () => 3);
  const want = linesNeeded(seconds, bpm);
  if (structure === 'hook') {
    const hook = clampLines(want);
    const options: Array<{ stanzas: number[]; repeat: boolean }> = [
      { stanzas: [hook], repeat: false },
      { stanzas: [hook, 2], repeat: false },
      { stanzas: [hook], repeat: true },
      { stanzas: [hook, 2], repeat: true },
    ];
    const pick = options.find((o) => lengthPlan({ seconds, bpm, structure, stanzas: o.stanzas, repeatHook: o.repeat }).enough) ?? options[options.length - 1]!;
    return pick.stanzas;
  }
  const count = DRAFT_STANZAS[structure];
  const base = Math.floor(want / count);
  let extra = want - base * count;
  return Array.from({ length: count }, () => {
    const lines = clampLines(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
    return lines;
  });
}

/**
 * The form for lyrics already written: `stanzas` is the line count of each stanza in order. `repeatHook` lets the
 * plan sing the first hook again (a drafted "후크만" only; the customer's own lines are never repeated by us).
 */
export function lengthPlan(input: { seconds: number | null; bpm: number; structure: LyricStructure; stanzas: readonly number[]; repeatHook: boolean }): LengthPlan {
  const bpm = input.bpm;
  const marks = structureMarks(input.structure, input.stanzas.length);
  const per = barsPerLine(bpm);
  const target = input.seconds ? targetBarsOf(input.seconds, bpm) : 0;
  const last = marks.length - 1;
  const sungOutro = last >= 1 && marks[last] === '[Outro]';
  const canRepeat = input.repeatHook && input.structure === 'hook' && marks[0] === '[Chorus]';

  let intro = false;
  let emptyOutro = false;
  let repeat = false;
  const breaksAfter = new Set<number>();

  const build = (): FormPart[] => {
    const out: FormPart[] = [];
    if (intro) out.push({ kind: 'section', mark: '[Intro]' });
    marks.forEach((mark, i) => {
      out.push({ kind: 'sung', stanza: i, mark });
      if (breaksAfter.has(i)) out.push({ kind: 'section', mark: '[Instrumental Break]' });
      if (i === 0 && repeat) {
        out.push({ kind: 'sung', stanza: 0, mark, repeat: true });
        // Back from the repeated hook into a sung outro through a break (as measured at 60 s).
        if (sungOutro) out.push({ kind: 'section', mark: '[Instrumental Break]' });
      }
    });
    if (emptyOutro) out.push({ kind: 'section', mark: '[Outro]' });
    return out;
  };
  const barsOf = (form: readonly FormPart[], line: number, section: number) =>
    form.reduce((sum, part) => sum + (part.kind === 'section' ? section : (input.stanzas[part.stanza] ?? 0) * line), 0);

  // The filling steps, in order (§12.11), each taken only while the form is short.
  const steps: Array<() => boolean> = [
    () => (intro ? false : ((intro = true), true)),
    () => (!sungOutro && !emptyOutro ? ((emptyOutro = true), true) : false),
    () => (marks.length && !breaksAfter.has(0) ? (breaksAfter.add(0), true) : false),
    () => (canRepeat && !repeat ? ((repeat = true), true) : false),
  ];
  for (let i = 1; i < last; i += 1) steps.push(() => (breaksAfter.has(i) ? false : (breaksAfter.add(i), true)));

  let form = build();
  if (input.seconds) {
    for (const step of steps) {
      if (barsOf(form, per.plan, SECTION_BARS.plan) >= target - 1e-9) break;
      if (step()) form = build();
    }
  }
  const planned = barsOf(form, per.plan, SECTION_BARS.plan);
  const enough = !input.seconds || planned >= target - 1e-9;
  const seconds = (bars: number) => Math.round((bars * 240) / bpm);
  return {
    seconds: input.seconds,
    bpm,
    band: bandOf(bpm),
    targetBars: round1(target),
    bars: round1(planned),
    needed: input.seconds ? linesNeeded(input.seconds, bpm) : 0,
    form,
    enough,
    missingLines: enough ? 0 : Math.ceil((target - planned) / per.plan - 1e-9),
    estimate: { min: seconds(barsOf(form, per.low, SECTION_BARS.low)), max: seconds(barsOf(form, per.median, SECTION_BARS.median)) },
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
  bars: number;
  enough: boolean;
  estimate: { min: number; max: number };
  form: FormPart[];
}

export function planRecord(plan: RunPlanRecord): RunPlanRecord {
  const { bpm, band, seconds, targetBars, needed, bars, enough, estimate, form } = plan;
  return { bpm, band, seconds, targetBars, needed, bars, enough, estimate, form };
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
