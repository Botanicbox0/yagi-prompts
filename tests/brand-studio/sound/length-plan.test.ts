import { describe, expect, it } from 'vitest';
import {
  barsPerLine,
  draftStanzaLines,
  formText,
  lengthPlan,
  lineSyllables,
  linesNeeded,
  LONG_RATIO,
  runTempo,
  SECTION_BARS,
  stanzaLines,
} from '@/lib/brand-studio/sound/length-plan';
import type { LyricStructure } from '@/lib/brand-studio/sound/lyrics';

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

/** The plan's own judgement for a measured form: planned bars against the bars the length wants. */
function judged(m: Measured): boolean {
  return m.lines * barsPerLine(m.bpm).plan + m.sections * SECTION_BARS.plan >= (m.target * m.bpm) / 240;
}

describe('the plan against the measurement', () => {
  it('counts the bars: 118 BPM 15/30/60 s want 3/6/12 lines, 78 BPM 30/60 s 4/7 (sections aside)', () => {
    expect([15, 30, 60].map((s) => linesNeeded(s, 118))).toEqual([3, 6, 12]);
    expect([30, 60].map((s) => linesNeeded(s, 78))).toEqual([4, 7]);
  });

  it('calls the forms that reached the length enough, and the 3 lines alone short', () => {
    expect(MEASURED.filter((m) => !judged(m)).map((m) => m.name[0])).toEqual(['p', 'E']);
    // 30 s: 7 lines, 3 lines with intro, break and empty outro, the hook twice; 60 s: the padded hook form.
    expect(MEASURED.filter(judged).map((m) => m.name[0])).toEqual(['A', 'B', 'C', 'D', 'F', 'G', 'H']);
    const clips = MEASURED.filter(judged).flatMap((m) => m.clips.map((c) => c >= m.target));
    // 25 of 26 songs at least the length (one A song 25.8 s against 30).
    expect(clips.filter(Boolean).length).toBe(25);
    expect(clips).toHaveLength(26);
  });

  it('produces the two measured forms that reached the length', () => {
    // 60 s, fast, a drafted hook: intro, hook 4, break, hook again, break, 2-line outro (69.1 70.0 66.8 67.6 s).
    const f = lengthPlan({ seconds: 60, bpm: 118, structure: 'hook', stanzas: draftStanzaLines('hook', 60, 118), repeatHook: true });
    expect(draftStanzaLines('hook', 60, 118)).toEqual([4, 2]);
    expect(formText(f.form)).toBe('[Intro] [Chorus] [Instrumental Break] [Chorus]* [Instrumental Break] [Outro]');
    // 30 s, fast, the customer's 3 lines: intro, the lines, break, empty outro (34.0 32.3 47.4 34.8 s).
    const c = lengthPlan({ seconds: 30, bpm: 118, structure: 'hook', stanzas: [3], repeatHook: false });
    expect(formText(c.form)).toBe('[Intro] [Chorus] [Instrumental Break] [Outro]');
    expect(c.enough).toBe(true);
  });
});

/** The standard 27: three lengths × three tempos × three structures, drafted (§12.11 table). */
const ROWS = ([15, 30, 60] as const).flatMap((seconds) =>
  ([118, 100, 78] as const).flatMap((bpm) =>
    (['hook', 'hook-verse', 'full'] as const).map((structure: LyricStructure) => {
      const stanzas = draftStanzaLines(structure, seconds, bpm);
      const plan = lengthPlan({ seconds, bpm, structure, stanzas, repeatHook: true });
      return { seconds, bpm, structure, stanzas, plan, ratio: plan.estimate.max / seconds };
    }),
  ),
);

describe('the standard 27', () => {
  it('lands every default structure (15 and 30 s hook, 60 s hook and verse) and the 60 s hook at 1.0–1.45 of the length', () => {
    const asked = ROWS.filter((r) => (r.structure === 'hook' && r.seconds <= 30) || (r.seconds === 60 && (r.structure === 'hook-verse' || r.structure === 'hook')));
    expect(asked).toHaveLength(12);
    for (const r of asked) {
      expect(r.plan.enough, `${r.seconds} s ${r.bpm} ${r.structure}`).toBe(true);
      expect(r.ratio, `${r.seconds} s ${r.bpm} ${r.structure}`).toBeGreaterThanOrEqual(1);
      expect(r.ratio, `${r.seconds} s ${r.bpm} ${r.structure}`).toBeLessThanOrEqual(1.45);
    }
  });

  it('never ends on a break, and fills a hook in the measured order', () => {
    for (const r of ROWS) expect(r.plan.form[r.plan.form.length - 1]!.mark, `${r.seconds} ${r.bpm} ${r.structure}`).not.toBe('[Instrumental Break]');
    const at = (s: number, bpm: number) => formText(ROWS.find((r) => r.seconds === s && r.bpm === bpm && r.structure === 'hook')!.plan.form);
    expect(at(15, 118)).toBe('[Chorus]');
    expect(at(30, 118)).toBe('[Intro] [Chorus] [Outro]');
    expect(at(30, 100)).toBe('[Intro] [Chorus]');
    expect(at(60, 100)).toBe('[Intro] [Chorus] [Instrumental Break] [Chorus]* [Outro]');
    expect(at(60, 78)).toBe('[Intro] [Chorus] [Outro]');
  });

  it('a structure with more stanzas than the length needs runs long, and says so (more than 1.45)', () => {
    const long = ROWS.filter((r) => r.ratio > LONG_RATIO).map((r) => `${r.seconds}/${r.bpm}/${r.structure}`);
    expect([...long].sort()).toEqual(
      [
        '15/118/hook-verse', '15/118/full', '15/100/hook-verse', '15/100/full', '15/78/hook-verse', '15/78/full',
        '30/100/hook-verse', '30/100/full', '30/118/full', '30/78/hook-verse', '30/78/full', '60/78/full',
      ].sort(),
    );
  });
});

describe('the customer’s own lyrics', () => {
  it('adds sections only, never repeats their lines, and says how short it still is', () => {
    const own = stanzaLines('노란 레몬 탄산이 톡 터지는 모아\n\n유리잔 위로 방울이 올라와\n내 손안에 시원한 모아');
    const three = lengthPlan({ seconds: 30, bpm: 118, structure: 'hook', stanzas: own, repeatHook: false });
    // The last stanza is a sung [Outro]: no empty one; 3 lines × 2.5 + 2 sections × 2.7 = 12.9 of 14.75 bars.
    expect(formText(three.form)).toBe('[Intro] [Chorus] [Instrumental Break] [Outro]');
    expect(three.form.some((p) => p.kind === 'sung' && p.repeat)).toBe(false);
    expect(three).toMatchObject({ enough: false, targetBars: 14.8, bars: 12.9, missingLines: 1 });
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
