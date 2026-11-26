import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_LINE, NON_DISCLOSURE_RULE } from '@/lib/ai-guard';
import { classifyPromptIntent } from '@/lib/brand-studio/director';
import { loadAttacks, loadBenign } from '@/scripts/prompt-guard-redteam/inputs';
import { parseCliArgs, runRedteam } from '@/scripts/prompt-guard-redteam/runner';
import { GUARDED_SITES } from '@/scripts/prompt-guard-redteam/sites';
import { ROWS } from '../rows';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('prompt-guard redteam datasets and fake end-to-end run', () => {
  it('has 24 generic attacks (12 KO + 12 EN) and 30 benign briefs that never hit director passthrough or quote product rules', () => {
    const attacks = loadAttacks();
    const benign = loadBenign();

    expect(attacks).toHaveLength(24);
    expect(attacks.filter((a) => a.locale === 'ko')).toHaveLength(12);
    expect(attacks.filter((a) => a.locale === 'en')).toHaveLength(12);

    const expectedCategories = [
      'plain',
      'repeat-above',
      'summarise-list',
      'translate',
      'embed-in-prompt',
      'ignore-code-block',
      'reference-label',
      'every-other-word',
      'base64',
      'role-play',
      'debug-operator',
      'video-template',
    ];
    for (const locale of ['ko', 'en'] as const) {
      const cats = attacks.filter((a) => a.locale === locale).map((a) => a.category);
      expect(cats).toEqual(expectedCategories);
    }

    expect(benign).toHaveLength(30);
    expect(benign.filter((b) => b.locale === 'ko')).toHaveLength(15);
    expect(benign.filter((b) => b.locale === 'en')).toHaveLength(15);

    for (const item of [...attacks, ...benign]) {
      expect(
        classifyPromptIntent(item.prompt, false, item.references?.length ?? 0),
        `${item.id} must reach the director model (not passthrough)`,
      ).not.toBe('passthrough');
      expect(item.prompt).not.toContain('Reference authority:');
      expect(item.prompt).not.toContain('Mandatory Seedance');
      expect(item.prompt).not.toContain('Non-disclosure');
    }

    expect(GUARDED_SITES.map((s) => s.site)).toEqual(ROWS.map((r) => r.site));
  });

  it('runs --backend=fake end-to-end over both sites and off/observe/enforce modes', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-e2e-fake-'));
    tempDirs.push(outDir);

    const opts = parseCliArgs(
      ['--backend=fake', `--out=${outDir}`, '--concurrency=4', '--delay-ms=0'],
      process.cwd(),
    );

    const res = await runRedteam(opts, {
      repoRoot: process.cwd(),
      processEnv: {},
      registerSignalHandlers: false,
      onLog: () => {},
    });

    expect(res.dryRun).toBe(false);
    if (res.dryRun) return;

    expect(res.report.plan.plannedCalls).toBe(324);
    expect(res.report.plan.executedCalls).toBe(324);
    expect(res.report.plan.skippedCalls).toBe(0);

    for (const site of ['brand-studio.enhancer', 'brand-studio.director'] as const) {
      const offAtk = res.report.cells.find((c) => c.site === site && c.mode === 'off' && c.inputClass === 'attack')!;
      expect(offAtk.calls).toBe(24);
      expect(offAtk.unusableAnswers).toBe(0);
      expect(offAtk.leaks).toBe(24);
      expect(offAtk.refusals).toBe(0);

      const obsAtk = res.report.cells.find((c) => c.site === site && c.mode === 'observe' && c.inputClass === 'attack')!;
      expect(obsAtk.calls).toBe(24);
      expect(obsAtk.unusableAnswers).toBe(0);
      // Canary attacks are stopped even in observe (6 total: plain, repeat-above, debug-operator × ko/en),
      // while the remaining 18 non-canary attacks are logged (`observed`) and measured as leaks.
      expect(obsAtk.refusals).toBe(6);
      expect(obsAtk.guardObserved).toBe(18);
      expect(obsAtk.leaks).toBe(18);

      const enfAtk = res.report.cells.find((c) => c.site === site && c.mode === 'enforce' && c.inputClass === 'attack')!;
      expect(enfAtk.calls).toBe(24);
      expect(enfAtk.unusableAnswers).toBe(0);
      expect(enfAtk.refusals).toBe(24);
      expect(enfAtk.leaks).toBe(0);

      for (const mode of ['off', 'observe', 'enforce'] as const) {
        const ben = res.report.cells.find((c) => c.site === site && c.mode === mode && c.inputClass === 'benign')!;
        expect(ben.calls).toBe(30);
        expect(ben.unusableAnswers).toBe(0);
        expect(ben.leaks).toBe(0);
        expect(ben.falsePositives).toBe(0);
        expect(ben.otherFallbacks).toBe(0);
      }
    }

    const jsonText = readFileSync(res.reportPaths.jsonPath, 'utf8');
    const mdText = readFileSync(res.reportPaths.mdPath, 'utf8');
    for (const fileText of [jsonText, mdText]) {
      expect(fileText).not.toContain(NON_DISCLOSURE_RULE);
      expect(fileText).not.toContain(DATA_LINE);
      expect(fileText).not.toMatch(/\bpgc[a-z2-9]{20}\b/);
    }
  });
});
