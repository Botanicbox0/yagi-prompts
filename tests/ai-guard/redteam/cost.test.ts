import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CostMeter, computeCostKrw, validateGeminiPricing } from '@/scripts/prompt-guard-redteam/cost';
import { loadInputs } from '@/scripts/prompt-guard-redteam/inputs';
import { parseCliArgs, runRedteam } from '@/scripts/prompt-guard-redteam/runner';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('cost meter, hard cap, pricing flags, and --dry-run', () => {
  it('refuses gemini without all four positive pricing flags and refuses --out inside the repo', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-cost-args-'));
    tempDirs.push(outDir);

    const base = ['--backend=gemini', `--out=${outDir}`];
    expect(() => parseCliArgs(base, process.cwd())).toThrow();
    expect(() =>
      parseCliArgs([...base, '--max-krw=1000', '--usd-krw=1400', '--price-in-usd-per-mtok=0.3'], process.cwd()),
    ).toThrow(/price-out-usd-per-mtok/);
    expect(() =>
      parseCliArgs([...base, '--max-krw=0', '--usd-krw=1400', '--price-in-usd-per-mtok=0.3', '--price-out-usd-per-mtok=2.5'], process.cwd()),
    ).toThrow();
    expect(() =>
      validateGeminiPricing({ maxKrw: 1000, usdKrw: 1400, priceInUsdPerMtok: 0.3 }),
    ).toThrow();

    expect(() =>
      parseCliArgs(['--backend=fake', '--out=scripts/inside-repo-report'], process.cwd()),
    ).toThrow(/inside repository/);
    expect(() =>
      parseCliArgs(['--backend=fake', `--out=${process.cwd()}`], process.cwd()),
    ).toThrow(/inside repository/);
  });

  it('tracks actual usage and refuses the call that would exceed --max-krw', () => {
    const pricing = validateGeminiPricing({
      maxKrw: 30,
      usdKrw: 1400,
      priceInUsdPerMtok: 0.3,
      priceOutUsdPerMtok: 2.5,
    });
    const meter = new CostMeter({ pricing, maxCalls: null });

    // Worst case of one call with 4096 output tokens at $2.50/MTok * 1400 KRW is ~14.336 KRW + input ~1-2 KRW (< 30 KRW)
    const r1 = meter.tryReserve('brand-studio.enhancer', 'short text', 0);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Actual usage spends 20 KRW (> 14 KRW remaining < 15 KRW worst-case for second call)
    const actualUsage = { inputTokens: 1_000_000, outputTokens: 5_554_286, totalTokens: 6_554_286 };
    const expectedCost = computeCostKrw(actualUsage, pricing);
    expect(expectedCost).toBeGreaterThan(15);
    const settled = meter.settle(r1.id, actualUsage);
    expect(settled).toBeCloseTo(expectedCost, 6);

    // Next call's worst case (~15 KRW) + spent (~19.8 KRW) > 30 KRW -> refused!
    const r2 = meter.tryReserve('brand-studio.enhancer', 'short text', 0);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('max_krw');
    expect(meter.snapshot().stoppedReason).toBe('max_krw');
  });

  it('stops a gemini run cleanly at the cap, writes partial report, and never exceeds --max-krw or --max-calls', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-cost-run-'));
    tempDirs.push(outDir);

    let fetchCount = 0;
    const fakeGeminiFetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: JSON.stringify({ prompt: 'A clean studio shot of a frosted bottle.', notes: 'Clean.' }) }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 2000,
            candidatesTokenCount: 1500,
            thoughtsTokenCount: 200,
            totalTokenCount: 3700,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const inputs = loadInputs(['benign'], 6);
    // Actual usage per call: (2000*0.3 + 1700*2.5)/1e6 * 1400 = 6.79 KRW.
    // Worst-case per call: ~16.5 KRW (cap 4096 out). With --max-krw=25:
    //   call 1: 0 + 16.5 <= 25 (allowed, settles 6.79 KRW)
    //   call 2: 6.79 + 16.5 = 23.29 <= 25 (allowed, settles 13.58 KRW total)
    //   call 3: 13.58 + 16.5 = 30.08 > 25 (blocked by max_krw!)
    const opts = parseCliArgs(
      [
        '--backend=gemini',
        '--sites=brand-studio.enhancer',
        '--modes=enforce',
        '--classes=benign',
        '--concurrency=1',
        '--delay-ms=0',
        '--max-krw=25',
        '--usd-krw=1400',
        '--price-in-usd-per-mtok=0.3',
        '--price-out-usd-per-mtok=2.5',
        `--out=${outDir}`,
      ],
      process.cwd(),
    );

    const res = await runRedteam(opts, {
      repoRoot: process.cwd(),
      baseFetch: fakeGeminiFetch,
      processEnv: { GEMINI_API_KEY: 'fake-key-for-cost-test' },
      inputs,
      registerSignalHandlers: false,
      onLog: () => {},
    });

    expect(res.dryRun).toBe(false);
    if (res.dryRun) return;

    expect(fetchCount).toBe(2);
    expect(res.report.stoppedReason).toBe('max_krw');
    expect(res.report.plan.executedCalls).toBe(2);
    expect(res.report.plan.plannedCalls).toBe(6);
    expect(res.report.plan.skippedCalls).toBe(4);
    expect(res.report.cost.inputTokens).toBe(4000);
    expect(res.report.cost.outputTokens).toBe(3400); // (1500 candidates + 200 thoughts) * 2
    expect(res.report.cost.spentKrw).toBeLessThanOrEqual(25);
    expect(readFileSync(res.reportPaths.mdPath, 'utf8')).toContain('Stopped early: `max_krw`');

    // Now test --max-calls=2
    fetchCount = 0;
    const outDir2 = mkdtempSync(path.join(tmpdir(), 'pg-max-calls-'));
    tempDirs.push(outDir2);
    const optsMaxCalls = parseCliArgs(
      [
        '--backend=gemini',
        '--sites=brand-studio.enhancer',
        '--modes=enforce',
        '--classes=benign',
        '--concurrency=1',
        '--delay-ms=0',
        '--max-calls=2',
        '--max-krw=50000',
        '--usd-krw=1400',
        '--price-in-usd-per-mtok=0.3',
        '--price-out-usd-per-mtok=2.5',
        `--out=${outDir2}`,
      ],
      process.cwd(),
    );
    const res2 = await runRedteam(optsMaxCalls, {
      repoRoot: process.cwd(),
      baseFetch: fakeGeminiFetch,
      processEnv: { GEMINI_API_KEY: 'fake-key-for-cost-test' },
      inputs,
      registerSignalHandlers: false,
      onLog: () => {},
    });
    expect(res2.dryRun).toBe(false);
    if (res2.dryRun) return;
    expect(fetchCount).toBe(2);
    expect(res2.report.stoppedReason).toBe('max_calls');
    expect(res2.report.plan.executedCalls).toBe(2);
  });

  it('--dry-run computes plan and worst-case KRW while calling the backend fetch 0 times', async () => {
    let fetchCount = 0;
    const forbiddenFetch = (async () => {
      fetchCount += 1;
      throw new Error('dry-run must never call fetch');
    }) as typeof fetch;

    const opts = parseCliArgs(
      [
        '--backend=gemini',
        '--dry-run',
        '--max-krw=10000',
        '--usd-krw=1400',
        '--price-in-usd-per-mtok=0.3',
        '--price-out-usd-per-mtok=2.5',
      ],
      process.cwd(),
    );

    const res = await runRedteam(opts, {
      repoRoot: process.cwd(),
      baseFetch: forbiddenFetch,
      processEnv: {},
      registerSignalHandlers: false,
      onLog: () => {},
    });

    expect(fetchCount).toBe(0);
    expect(res.dryRun).toBe(true);
    if (!res.dryRun) return;
    expect(res.plan.totalPlannedCalls).toBe(324);
    expect(res.plan.estimatedInputTokens).toBeGreaterThan(0);
    expect(res.plan.estimatedOutputCapTokens).toBe(324 * 4096);
    expect(res.plan.estimatedWorstCaseKrw).toBeGreaterThan(0);
  });
});
