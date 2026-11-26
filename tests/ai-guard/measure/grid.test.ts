/**
 * Threshold measurement, step 2 (docs/PROMPT-GUARD.md "How the thresholds were chosen"). Skipped unless
 * `PROMPT_GUARD_MEASURE_IN` names a recording made by `record-setup.ts`. For every recorded check (each one a
 * stored answer of the existing tests going out through an adopted site) it counts refusals per detector and
 * threshold, and writes the table to `$PROMPT_GUARD_MEASURE_IN.grid.json`. Nothing here asserts: it measures.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  carriesCanary,
  Corpus,
  decodedReadings,
  DEFAULT_THRESHOLDS,
  gappedLength,
  hangulShare,
  runDetector,
  unitsOf,
  wordShare,
} from '@/lib/ai-guard/outgoing';

const IN = process.env.PROMPT_GUARD_MEASURE_IN;

interface Recorded {
  file: string | null;
  test: string | null;
  fields: Record<string, string>;
  internal: string | string[];
  canary: string | null;
  exempt: string[];
  allow: string[];
}

describe.skipIf(!IN || !existsSync(IN))('prompt guard threshold grid', () => {
  it('counts refusals per threshold over every recorded check', () => {
    // The guard's own tests feed leaks on purpose: of those, only the benign controls are measured.
    const rows = readFileSync(IN!, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Recorded)
      .filter((r) => !/[\\/]tests[\\/]ai-guard[\\/]/.test(r.file ?? '') || /benign answer passes untouched/.test(r.test ?? ''));
    const grid = {
      runWords: [6, 7, 8, 9, 10],
      runLatin: [32, 40, 48, 56, 64],
      runHangul: [8, 10, 12, 14, 16],
      shareWords: [0.2, 0.25, 0.3, 0.35, 0.4, 0.5],
      shareHangul: [0.3, 0.4, 0.5, 0.6],
      gappedWords: [8, 10, 12, 14, 16],
    };
    const count = {
      runWords: grid.runWords.map(() => 0),
      runLatin: grid.runLatin.map(() => 0),
      runHangul: grid.runHangul.map(() => 0),
      shareWords: grid.shareWords.map(() => 0),
      shareHangul: grid.shareHangul.map(() => 0),
      gappedWords: grid.gappedWords.map(() => 0),
      canary: 0,
      encodedAtDefaults: 0,
      fields: 0,
      maxWordShare: 0,
      maxHangulShare: 0,
      maxGapped: 0,
    };
    const hits: Array<{ test: string | null; field: string; what: string }> = [];
    for (const row of rows) {
      const internal = new Corpus(typeof row.internal === 'string' ? [row.internal] : row.internal);
      const permitted = new Corpus([...row.exempt, ...row.allow]);
      for (const [field, text] of Object.entries(row.fields)) {
        if (!text.trim()) continue;
        count.fields += 1;
        const u = unitsOf(text, permitted);
        if (carriesCanary(text, row.canary)) count.canary += 1;
        grid.runWords.forEach((k, i) => {
          if (runDetector(u, internal, permitted, { ...DEFAULT_THRESHOLDS, runWords: k, runLatin: 10_000, runHangul: 10_000 }) === 'word_run') {
            count.runWords[i]! += 1;
            if (k === 8) hits.push({ test: row.test, field, what: 'word_run@8' });
          }
        });
        grid.runLatin.forEach((k, i) => {
          if (runDetector(u, internal, permitted, { ...DEFAULT_THRESHOLDS, runWords: 10_000, runLatin: k, runHangul: 10_000 }) === 'latin_run') {
            count.runLatin[i]! += 1;
            if (k === DEFAULT_THRESHOLDS.runLatin) hits.push({ test: row.test, field, what: `latin_run@${k}` });
          }
        });
        grid.runHangul.forEach((k, i) => {
          if (runDetector(u, internal, permitted, { ...DEFAULT_THRESHOLDS, runWords: 10_000, runLatin: 10_000, runHangul: k }) === 'hangul_run') count.runHangul[i]! += 1;
        });
        const ws = wordShare(u, internal, permitted);
        const hs = hangulShare(u, internal, permitted);
        const gl = gappedLength(u, internal);
        count.maxWordShare = Math.max(count.maxWordShare, ws);
        count.maxHangulShare = Math.max(count.maxHangulShare, hs);
        count.maxGapped = Math.max(count.maxGapped, gl);
        grid.shareWords.forEach((t, i) => (ws > t ? (count.shareWords[i]! += 1) : undefined));
        grid.shareHangul.forEach((t, i) => (hs > t ? (count.shareHangul[i]! += 1) : undefined));
        grid.gappedWords.forEach((t, i) => {
          if (gl >= t) {
            count.gappedWords[i]! += 1;
            if (t === DEFAULT_THRESHOLDS.gappedWords) hits.push({ test: row.test, field, what: `gapped=${gl}` });
          }
        });
        for (const r of decodedReadings(text)) if (runDetector(unitsOf(r.text, permitted), internal, permitted)) count.encodedAtDefaults += 1;
      }
    }
    const report = { checks: rows.length, files: [...new Set(rows.map((r) => r.file))].length, grid, count, hits };
    writeFileSync(`${IN}.grid.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ checks: rows.length, ...count, hits: hits.length }, null, 1));
    expect(rows.length).toBeGreaterThan(0);
  });
});
