import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

function runCli(args: string[], envOverrides: Record<string, string | undefined>) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.GEMINI_API_KEY;
  delete cleanEnv.GEMINI_BASE_URL;
  delete cleanEnv.PROMPT_GUARD;
  delete cleanEnv.PROMPT_GUARD_ENFORCE;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete cleanEnv[k];
    else cleanEnv[k] = v;
  }
  return spawnSync(process.execPath, [tsxCli, '--conditions=react-server', 'scripts/prompt-guard-redteam.ts', ...args], {
    cwd: process.cwd(),
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 45_000,
  });
}

describe('CLI secret handling (no environment values printed or stored)', () => {
  it('prints only boolean key presence and scrubs/never outputs fake secret values across stdout, stderr, and reports', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-nosecret-'));
    tempDirs.push(outDir);

    const sentinelKey = 'pg-fake-sentinel-api-key-value-9876543210';
    const sentinelUnrelated = 'pg-unrelated-env-secret-value-abcdef12345';
    const envFilePath = path.join(outDir, 'test.env');
    writeFileSync(
      envFilePath,
      `GEMINI_API_KEY=${sentinelKey}\nUNRELATED_SECRET=${sentinelUnrelated}\n`,
      'utf8',
    );

    const fakeRun = runCli(
      [
        '--backend=fake',
        '--sites=brand-studio.enhancer',
        '--modes=off,enforce',
        '--limit=2',
        '--delay-ms=0',
        `--env-file=${envFilePath}`,
        `--out=${outDir}`,
      ],
      {},
    );

    expect(fakeRun.status, fakeRun.stderr).toBe(0);
    expect(fakeRun.stdout).toContain('GEMINI_API_KEY present: true');

    const jsonText = readFileSync(path.join(outDir, 'report.json'), 'utf8');
    const mdText = readFileSync(path.join(outDir, 'report.md'), 'utf8');

    for (const text of [fakeRun.stdout, fakeRun.stderr, jsonText, mdText]) {
      expect(text).not.toContain(sentinelKey);
      expect(text).not.toContain(sentinelUnrelated);
    }

    const dryEnvSecret = 'pg-process-env-sentinel-value-5566778899';
    const dryRun = runCli(
      [
        '--backend=gemini',
        '--dry-run',
        '--max-krw=5000',
        '--usd-krw=1400',
        '--price-in-usd-per-mtok=0.3',
        '--price-out-usd-per-mtok=2.5',
      ],
      { GEMINI_API_KEY: dryEnvSecret },
    );

    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(dryRun.stdout).toContain('GEMINI_API_KEY present: true');
    expect(dryRun.stdout).toContain('Planned calls: 324');
    expect(dryRun.stdout).not.toContain(dryEnvSecret);
    expect(dryRun.stderr).not.toContain(dryEnvSecret);
  });
});
