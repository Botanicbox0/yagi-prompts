import { describe, expect, it } from 'vitest';
import { draftStanzaLines, formText, lengthPlan, lineSyllables, linesNeeded, runTempo, SECTION_BARS, barsPerLine, stanzaLines } from '@/lib/brand-studio/sound/length-plan';

/**
 * The length plan (docs/BRAND-SOUND-STUDIO.md §12.11) against the lead's real engine measurement of 2026-11-21
 * (14 requests, 28 songs, $1.40; D:\dev\_backups\twings-sound-tests-20261120\length-test-20261121, out-1/out-2
 * log.json), plus the production run that started it (3 lines, 118 BPM, 30 s chosen, both versions 16.0 s).
 * Kept as fixed data: the coefficients can be fitted again from new runs (the run records its plan).
 */
interface Measured {
  name: string;
  bpm: number;
  target: number;
  /** Sung lines as sent (a repeated hook counts twice), and instrumental sections ([Intro], [Instrumental Break], empty [Outro]). */
  lines: number;
  sections: number;
  clips: number[];
}

const MEASURED: Measured[] = [
  { name: 'production: 3 lines (as run on 2026-11-21)', bpm: 118, target: 30, lines: 3, sections: 0, clips: [16.0, 16.0] },
  { name: 'E control: 3 lines 33 syllables', bpm: 118, target: 30, lines: 3, sections: 0, clips: [27.28, 22.88] },
  { name: 'A more words: 7 lines 66 syllables', bpm: 118, target: 30, lines: 7, sections: 0, clips: [25.8, 32.8, 30.76, 34, 33.96, 34.4] },
  { name: 'B hook twice: 6 lines', bpm: 118, target: 30, lines: 6, sections: 0, clips: [43.68, 42.36, 33.56, 34.6] },
  { name: 'C 3 lines + intro, break, empty outro', bpm: 118, target: 30, lines: 3, sections: 3, clips: [33.96, 32.28, 47.44, 34.8] },
  { name: 'D English 7 lines', bpm: 118, target: 30, lines: 7, sections: 0, clips: [31.08, 33.96, 34.8, 34.68] },
  { name: 'F 60 s: intro, hook 4, break, hook 4, break, outro 2', bpm: 118, target: 60, lines: 10, sections: 3, clips: [69.12, 70, 66.76, 67.6] },
  { name: 'G 60 s: 15 lines', bpm: 118, target: 60, lines: 15, sections: 0, clips: [87.16, 80.8] },
  { name: 'H 78 BPM 30 s: 4 lines', bpm: 78, target: 30, lines: 4, sections: 0, clips: [43.2, 42.8] },
];

/** The plan's own judgement for a measured form: line-equivalents against what the length needs. */
function judged(m: Measured): boolean {
  const per = barsPerLine(m.bpm).plan;
  return m.lines + (m.sections * SECTION_BARS) / per >= linesNeeded(m.target, m.bpm);
}

describe('the plan against the measurement', () => {
  it('needs the lines the rule gives: 118 BPM 15/30/60 s → 4/7/14, 78 BPM 30/60 s → 4/7', () => {
    expect([15, 30, 60].map((s) => linesNeeded(s, 118))).toEqual([4, 7, 14]);
    expect([30, 60].map((s) => linesNeeded(s, 78))).toEqual([4, 7]);
  });

  it('calls the production run (3 lines, 118 BPM, 30 s) short, and the forms it calls enough reach the length', () => {
    expect(judged(MEASURED[0]!)).toBe(false);
    const enough = MEASURED.filter(judged);
    const clips = enough.flatMap((m) => m.clips.map((c) => c >= m.target));
    // A, D, G, H: 13 of 14 songs at least the length (one A song 25.8 s against 30).
    expect(enough.map((m) => m.name[0])).toEqual(['A', 'D', 'G', 'H']);
    expect(clips.filter(Boolean).length / clips.length).toBeGreaterThanOrEqual(0.9);
    // Every song the plan calls short that was in fact short is the 3-line form the screen made.
    const shortSongs = MEASURED.flatMap((m) => m.clips.filter((c) => c < m.target).map(() => m.name));
    expect(shortSongs.every((n) => /3 lines|A more words/.test(n))).toBe(true);
  });
});

describe('drafted lyrics', () => {
  it('spreads the lines over the stanzas, 2 to 4 each', () => {
    expect(draftStanzaLines('hook', 15, 118)).toEqual([4]);
    expect(draftStanzaLines('hook', 30, 118)).toEqual([4]);
    expect(draftStanzaLines('hook-verse', 30, 118)).toEqual([2, 2, 2, 2]);
    expect(draftStanzaLines('full', 60, 118)).toEqual([3, 3, 3, 3, 2]);
    expect(draftStanzaLines('hook', 30, 78)).toEqual([4]);
  });

  it('fills a short hook with an intro, a break and the hook again, never with more words', () => {
    const p30 = lengthPlan({ seconds: 30, bpm: 118, structure: 'hook', stanzas: [4], repeatHook: true });
    expect(formText(p30.form)).toBe('[Intro] [Chorus] [Instrumental Break] [Chorus]*');
    expect(p30).toMatchObject({ needed: 7, units: 10, enough: true, missingLines: 0, targetBars: 14.8 });
    const p60 = lengthPlan({ seconds: 60, bpm: 118, structure: 'hook', stanzas: [4], repeatHook: true });
    expect(formText(p60.form)).toBe('[Intro] [Chorus] [Instrumental Break] [Chorus]* [Instrumental Break] [Chorus]* [Outro]');
    expect(p60.enough).toBe(true);
    const p15 = lengthPlan({ seconds: 15, bpm: 118, structure: 'hook', stanzas: [4], repeatHook: true });
    expect(formText(p15.form)).toBe('[Chorus]');
    expect(p15.enough).toBe(true);
  });

  it('plans a longer structure with its own lines, sections only when they run out', () => {
    const full = lengthPlan({ seconds: 60, bpm: 118, structure: 'full', stanzas: [3, 3, 3, 3, 2], repeatHook: true });
    expect(formText(full.form)).toBe('[Verse 1] [Chorus] [Verse 2] [Chorus] [Outro]');
    expect(full.enough).toBe(true);
  });
});

describe('the customer’s own lyrics', () => {
  it('adds sections only, never repeats their lines, and says how short it still is', () => {
    const three = lengthPlan({ seconds: 30, bpm: 118, structure: 'hook', stanzas: stanzaLines('노란 레몬 탄산이 톡 터지는 모아\n\n유리잔 위로 방울이 올라와\n내 손안에 시원한 모아'), repeatHook: false });
    expect(formText(three.form)).toBe('[Intro] [Chorus] [Instrumental Break] [Outro]');
    expect(three.form.some((p) => p.kind === 'sung' && p.repeat)).toBe(false);
    // 3 lines + 2 sections = 5 of 7 line-equivalents (the last stanza is a sung [Outro], so no empty one is added).
    expect(three).toMatchObject({ enough: false, needed: 7, units: 5, missingLines: 2 });
    expect(three.estimate.min).toBeLessThan(30);
    const seven = lengthPlan({ seconds: 30, bpm: 118, structure: 'hook', stanzas: [4, 3], repeatHook: false });
    expect(seven.form.filter((p) => p.kind === 'section')).toHaveLength(0);
    expect(seven.enough).toBe(true);
  });

  it('no length chosen: the lyrics as written, nothing added', () => {
    const plan = lengthPlan({ seconds: null, bpm: 100, structure: 'hook', stanzas: [2], repeatHook: false });
    expect(formText(plan.form)).toBe('[Chorus]');
    expect(plan.enough).toBe(true);
  });
});

describe('tempo and line length', () => {
  it('decides the tempo once: a written BPM, then the draft’s, then the words’, then the mid band', () => {
    expect(runTempo({ description: '92 BPM 상쾌한 팝', draftBpm: 120, wordsBpm: 120 })).toBe(92);
    expect(runTempo({ description: '상쾌한 팝', draftBpm: 116, wordsBpm: 120 })).toBe(116);
    expect(runTempo({ description: '상쾌한 팝', wordsBpm: 120 })).toBe(120);
    expect(runTempo({ description: '브랜드 소개' })).toBe(100);
    expect(runTempo({ description: '브랜드 소개', draftBpm: 400 })).toBe(100);
  });

  it('counts a line’s syllables in Korean and roughly in English', () => {
    expect(lineSyllables('노란 레몬 탄산이 톡 터지는 모아')).toBe(13);
    expect(lineSyllables('One sip and the morning clears')).toBe(7);
  });
});
