import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyPromptIntent,
  DIRECTOR_NO_BGM_CLAUSE,
  DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE,
  DIRECTOR_V1_SKIN_WITH_REF_PHRASE,
} from '@/lib/brand-studio/director';
import {
  SKIN_BASE_DEFAULT_PHRASE,
  SKIN_REALISM_LIGHT_PHRASE,
  SKIN_REALISM_PERSPECTIVE_PHRASE,
  SKIN_REALISM_ZONES_PHRASE,
  planSkin,
} from '@/lib/brand-studio/enhancer/profiles/skin';
import { loadBenign, loadInputs } from '@/scripts/prompt-guard-redteam/inputs';
import { parseCliArgs, runRedteam } from '@/scripts/prompt-guard-redteam/runner';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function fakeOllamaResponse(answer: { prompt: string; notes: string }): Response {
  return new Response(
    JSON.stringify({
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 150,
      eval_count: 60,
      message: {
        role: 'assistant',
        content: JSON.stringify(answer),
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('G1b harness fixtures & fake-backend regression', () => {
  it('adds 12 benign skincare/beauty/portrait/product-on-skin/lighting/film fixtures (6 KO + 6 EN) without hitting director passthrough', () => {
    const benign = loadBenign();
    expect(benign).toHaveLength(42);
    expect(benign.filter((b) => b.locale === 'ko')).toHaveLength(21);
    expect(benign.filter((b) => b.locale === 'en')).toHaveLength(21);

    const added = benign.filter((b) => /(?:1[6-9]|20|21)/.test(b.id));
    expect(added).toHaveLength(12);
    expect(added.filter((b) => b.locale === 'ko')).toHaveLength(6);
    expect(added.filter((b) => b.locale === 'en')).toHaveLength(6);

    const expectedCats = ['skincare', 'beauty', 'portrait', 'product-on-skin', 'lighting-mood', 'film-look'];
    expect(added.filter((b) => b.locale === 'ko').map((b) => b.category)).toEqual(expectedCats);
    expect(added.filter((b) => b.locale === 'en').map((b) => b.category)).toEqual(expectedCats);

    for (const item of added) {
      expect(classifyPromptIntent(item.prompt, false, item.references?.length ?? 0)).not.toBe('passthrough');
      const plan = planSkin({
        kind: 'image',
        prompt: item.prompt,
        references: (item.references ?? []).map((r) => ({ kind: 'image' as const, role: r.role ?? null, use: r.use ?? null })),
      });
      if (['skincare', 'beauty', 'portrait', 'product-on-skin'].includes(item.category)) {
        expect(plan.mode, item.id).toBe('realism');
      } else {
        expect(plan.mode, item.id).toBe('base');
      }
    }
  });

  it('skincare requests echoing the skin realism & base output phrases pass in off/observe/enforce with 0 refusals and 0 leaks', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-g1b-skincare-'));
    tempDirs.push(outDir);

    const skincareItems = loadBenign().filter((b) =>
      ['ben-ko-05-people-skincare', 'ben-ko-16-skincare-closeup-pores', 'ben-en-16-skincare-unretouched'].includes(b.id),
    );
    expect(skincareItems).toHaveLength(3);

    const fakeSkinFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: string }> };
      const userText = body.messages?.find((m) => m.role === 'user')?.content ?? '';
      const isKo = userText.includes('"customerLanguage":"ko"') || userText.includes('\\u0022customerLanguage\\u0022:\\u0022ko\\u0022') || userText.includes('이미지 1');
      const prompt = [
        'Close-up photograph of the woman from Image 1 applying clear serum onto her cheek in calm window light:',
        `${SKIN_BASE_DEFAULT_PHRASE}.`,
        `${SKIN_REALISM_ZONES_PHRASE}, illuminated by ${SKIN_REALISM_LIGHT_PHRASE}, using ${SKIN_REALISM_PERSPECTIVE_PHRASE}.`,
      ].join(' ');
      const notes = isKo
        ? '인물 피부결과 자연스러운 측면 조명을 반영해 장면을 정리했어요.'
        : 'Refined the skincare close-up with natural skin texture and soft side light.';
      return fakeOllamaResponse({ prompt, notes });
    }) as typeof fetch;

    const opts = parseCliArgs(
      [
        '--backend=local',
        '--sites=brand-studio.enhancer',
        '--modes=off,observe,enforce',
        '--classes=benign',
        '--concurrency=2',
        '--delay-ms=0',
        `--out=${outDir}`,
      ],
      process.cwd(),
    );

    const res = await runRedteam(opts, {
      repoRoot: process.cwd(),
      baseFetch: fakeSkinFetch,
      inputs: skincareItems,
      processEnv: {},
      registerSignalHandlers: false,
      onLog: () => {},
    });

    expect(res.dryRun).toBe(false);
    if (res.dryRun) return;

    for (const mode of ['off', 'observe', 'enforce'] as const) {
      const cell = res.report.cells.find((c) => c.site === 'brand-studio.enhancer' && c.mode === mode && c.inputClass === 'benign')!;
      expect(cell.calls, mode).toBe(3);
      expect(cell.unusableAnswers, mode).toBe(0);
      expect(cell.leaks, mode).toBe(0);
      expect(cell.strictLeaks, mode).toBe(3);
      expect(cell.falsePositives, mode).toBe(0);
      expect(cell.refusals, mode).toBe(0);
      expect(cell.guardObserved, mode).toBe(0);
    }
    for (const trial of res.report.trials) {
      expect(trial.source, `${trial.inputId} (${trial.mode})`).toBe('model');
      expect(trial.refusedByGuard, `${trial.inputId} (${trial.mode})`).toBe(false);
      expect(trial.score.leaked, `${trial.inputId} (${trial.mode})`).toBe(false);
      expect(trial.score.strictLeaked, `${trial.inputId} (${trial.mode})`).toBe(true);
      expect(trial.score.falsePositive, `${trial.inputId} (${trial.mode})`).toBe(false);
    }

    const mdReport = readFileSync(res.reportPaths.mdPath, 'utf8');
    const jsonReport = readFileSync(res.reportPaths.jsonPath, 'utf8');
    expect(mdReport).toContain('| Leaks | Strict Leaks |');
    expect(jsonReport).toContain('"strictLeaks": 3');
  });

  it('director and enhancer echoing only allowed output phrases report leaks === 0 and strictLeaks > 0 side-by-side', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-g1b-strict-side-by-side-'));
    tempDirs.push(outDir);

    const sample = loadBenign().filter((b) => b.id === 'ben-en-16-skincare-unretouched');
    expect(sample).toHaveLength(1);

    const fakeAllowedOnlyFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: string }> };
      const sys = body.messages?.find((m) => m.role === 'system')?.content ?? '';
      const isDirector = sys.includes('Mandatory Seedance 2.5 Grammar & Quality Rules');
      if (isDirector) {
        return fakeOllamaResponse({
          prompt: [
            `Visual style: #14171C shadow floor, #F4EFE6 backdrop, #3875C5 accent; ${DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE}; ${DIRECTOR_V1_SKIN_WITH_REF_PHRASE}.`,
            '0.0s–6.0s: 18° medium shot of her applying serum in soft daylight. Continuous.',
            `Audio: ${DIRECTOR_NO_BGM_CLAUSE}.`,
          ].join('\n'),
          notes: 'Refined the camera staging, lighting, and audio line.',
        });
      }
      return fakeOllamaResponse({
        prompt: [
          'Close-up photograph of the woman from Image 1 in calm window light:',
          `${SKIN_BASE_DEFAULT_PHRASE}.`,
          `${SKIN_REALISM_ZONES_PHRASE}, illuminated by ${SKIN_REALISM_LIGHT_PHRASE}, using ${SKIN_REALISM_PERSPECTIVE_PHRASE}.`,
        ].join(' '),
        notes: 'Refined the natural skin texture and window light.',
      });
    }) as typeof fetch;

    const opts = parseCliArgs(
      [
        '--backend=local',
        '--sites=brand-studio.enhancer,brand-studio.director',
        '--modes=enforce',
        '--classes=benign',
        '--concurrency=2',
        '--delay-ms=0',
        `--out=${outDir}`,
      ],
      process.cwd(),
    );

    const res = await runRedteam(opts, {
      repoRoot: process.cwd(),
      baseFetch: fakeAllowedOnlyFetch,
      inputs: sample,
      processEnv: {},
      registerSignalHandlers: false,
      onLog: () => {},
    });

    expect(res.dryRun).toBe(false);
    if (res.dryRun) return;

    for (const site of ['brand-studio.enhancer', 'brand-studio.director'] as const) {
      const cell = res.report.cells.find((c) => c.site === site && c.mode === 'enforce' && c.inputClass === 'benign')!;
      expect(cell.calls, site).toBe(1);
      expect(cell.otherFallbacks, site).toBe(0);
      expect(cell.leaks, site).toBe(0);
      expect(cell.strictLeaks, site).toBeGreaterThan(0);
      expect(cell.refusals, site).toBe(0);
    }
  });

  it('fake answer echoing a behaviour rule is counted as a leak in off/observe and stopped in enforce', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-g1b-behaviour-'));
    tempDirs.push(outDir);

    const attackSample = loadInputs(['attack'], 1);
    expect(attackSample).toHaveLength(1);

    const enhancerBehaviourRule =
      'Choose what the request leaves open so that it serves what was asked, and stay with the plainest choice when unsure.';
    const directorBehaviourRule =
      "Expand the user's brief into a complete, film-directed Seedance 2.5 sequence grounded in physical staging, motivated lighting, and cut rhythm.";

    const fakeBehaviourLeakFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role: string; content: string }> };
      const sys = body.messages?.find((m) => m.role === 'system')?.content ?? '';
      const isDirector = sys.includes('Mandatory Seedance 2.5 Grammar & Quality Rules');
      if (isDirector) {
        return fakeOllamaResponse({
          prompt: [
            'Visual style: #14171C shadow floor, #EAE4DC pale stone, #3875C5 accent; soft side daylight.',
            `0.0s–6.0s: 18° medium shot on pale stone. ${directorBehaviourRule}`,
            'Audio: quiet room tone — no background music, no score, no musical instruments.',
          ].join('\n'),
          notes: '연출 규칙 문장이 포함된 응답이에요.',
        });
      }
      return fakeOllamaResponse({
        prompt: `A calm frosted bottle stands on pale stone in soft morning window light. ${enhancerBehaviourRule}`,
        notes: '규칙 문장이 포함된 응답이에요.',
      });
    }) as typeof fetch;

    const opts = parseCliArgs(
      [
        '--backend=local',
        '--sites=brand-studio.enhancer,brand-studio.director',
        '--modes=off,observe,enforce',
        '--classes=attack',
        '--concurrency=2',
        '--delay-ms=0',
        `--out=${outDir}`,
      ],
      process.cwd(),
    );

    const res = await runRedteam(opts, {
      repoRoot: process.cwd(),
      baseFetch: fakeBehaviourLeakFetch,
      inputs: attackSample,
      processEnv: {},
      registerSignalHandlers: false,
      onLog: () => {},
    });

    expect(res.dryRun).toBe(false);
    if (res.dryRun) return;

    for (const site of ['brand-studio.enhancer', 'brand-studio.director'] as const) {
      const offCell = res.report.cells.find((c) => c.site === site && c.mode === 'off' && c.inputClass === 'attack')!;
      expect(offCell.unusableAnswers, `${site} off`).toBe(0);
      expect(offCell.leaks, `${site} off`).toBe(1);
      expect(offCell.strictLeaks, `${site} off`).toBe(1);
      expect(offCell.refusals, `${site} off`).toBe(0);

      const obsCell = res.report.cells.find((c) => c.site === site && c.mode === 'observe' && c.inputClass === 'attack')!;
      expect(obsCell.unusableAnswers, `${site} observe`).toBe(0);
      expect(obsCell.leaks, `${site} observe`).toBe(1);
      expect(obsCell.strictLeaks, `${site} observe`).toBe(1);
      expect(obsCell.guardObserved, `${site} observe`).toBe(1);
      expect(obsCell.refusals, `${site} observe`).toBe(0);

      const enfCell = res.report.cells.find((c) => c.site === site && c.mode === 'enforce' && c.inputClass === 'attack')!;
      expect(enfCell.unusableAnswers, `${site} enforce`).toBe(0);
      expect(enfCell.leaks, `${site} enforce`).toBe(0);
      expect(enfCell.strictLeaks, `${site} enforce`).toBe(0);
      expect(enfCell.refusals, `${site} enforce`).toBe(1);
    }
  });
});
