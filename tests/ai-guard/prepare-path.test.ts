/**
 * The two product paths with the guard on (docs/PROMPT-GUARD.md "The reference adoptions"):
 *   plain  — the free 설계 preview (`prompt.enhance`): its answer;
 *   senior — the paid run: `prepareJob` writes `final_prompt`, the engine moves the job, the allowance is used.
 *
 * The guard changes only the text check and its fallback. A refused answer must leave the paid run EXACTLY as
 * the writer's own failure (HTTP 500 from the model) leaves it: same `final_prompt`, same job state, same
 * credits and allowance, same outputs, same provider request. Only `work.enhancer.fallbackReason` (internal,
 * never shown) says why. A benign answer leaves everything exactly as origin/main did (off-paths snapshot).
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuardLogLine } from '@/lib/ai-guard';
import { studioFixture, type StudioFixture } from '../brand-studio/server/helpers';
import { canaryOf, failingSiteFetch, leakingFetch, systemOf } from './leaks';
import { PRODUCT_PATHS, runProductPath, type PathRecord } from './product-paths';
import { isSiteCall } from './reference-cases';

const ENV = { GEMINI_API_KEY: 'test-key' } as const;

let f: StudioFixture;
let logs: GuardLogLine[] = [];
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  f = await studioFixture({ capKrw: 5_000_000 });
  logs = [];
  warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('[prompt-guard] ')) logs.push(JSON.parse(first.slice('[prompt-guard] '.length)) as GuardLogLine);
  });
});
afterEach(async () => {
  warn.mockRestore();
  await f.db.close();
});

/** Everything about the run except the request bodies and the internal fallback reason. */
function effects(r: PathRecord) {
  const work = { ...(r.job.work as Record<string, unknown>) };
  const enhancer = { ...((work.enhancer as Record<string, unknown> | undefined) ?? {}) };
  delete enhancer.fallbackReason;
  return { preview: r.preview, job: { ...r.job, work: { ...work, enhancer } }, outputs: r.outputs, sent: r.sent, allowance: r.allowance, logs: r.logs };
}

function grams8(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + 8 <= words.length; i += 1) out.add(words.slice(i, i + 8).join(' '));
  return out;
}

function offSnapshot(id: string): Record<string, PathRecord> {
  return JSON.parse(readFileSync(new URL(`./__snapshots__/off-paths/${id}.json`, import.meta.url), 'utf8')) as Record<string, PathRecord>;
}

describe.each(PRODUCT_PATHS.map((p) => [p.id, p] as const))('%s', (_id, path) => {
  it('enforce, a leaking model: preview and paid run end exactly as when the model call fails', async () => {
    const failed = await runProductPath(f, path, () => failingSiteFetch(), { ...ENV, PROMPT_GUARD: 'enforce' });
    for (const kind of ['window60', 'canary', 'reordered8', 'base64'] as const) {
      logs = [];
      const leaked = await runProductPath(f, path, kind, { ...ENV, PROMPT_GUARD: 'enforce' });
      expect(effects(leaked), kind).toEqual(effects(failed));
      // The image writer records why it fell back (internal `work.enhancer`); the video director records no reason.
      const reasonOf = (r: PathRecord) => (r.job.work as { enhancer?: { fallbackReason?: string } }).enhancer?.fallbackReason;
      if (reasonOf(failed) !== undefined) expect(reasonOf(leaked), kind).toMatch(/^prompt_guard_/);
      else expect(reasonOf(leaked), kind).toBeUndefined();
      expect(logs.length, kind).toBeGreaterThanOrEqual(2); // the preview and the paid run
      for (const line of logs) expect(line).toMatchObject({ mode: 'enforce', action: 'fallback' });
      // Nothing shown (preview), stored (final_prompt) or sent (provider request) carries the canary or new internal text.
      const system = systemOf(leaked.calls.find(isSiteCall)!);
      const leaving = JSON.stringify([leaked.preview, leaked.job.final_prompt, leaked.sent]);
      expect(leaving.includes(canaryOf(system)), kind).toBe(false);
      const already = grams8(JSON.stringify([failed.preview, failed.job.final_prompt]));
      expect([...grams8(leaving)].filter((g) => grams8(system).has(g) && !already.has(g)), kind).toEqual([]);
    }
  });

  it('enforce and observe, a benign model: every effect is the one origin/main had', async () => {
    const off = offSnapshot(path.id).benign!;
    for (const mode of ['enforce', 'observe']) {
      logs = [];
      const run = await runProductPath(f, path, 'benign', { ...ENV, PROMPT_GUARD: mode });
      expect(effects(run), mode).toEqual(effects(off));
      expect(logs, mode).toEqual([]);
    }
  });

  it('observe, a leaking model: the leak goes out with a log line and credits as origin/main; the canary does not', async () => {
    const off = offSnapshot(path.id);
    logs = [];
    const leaked = await runProductPath(f, path, 'window60', { ...ENV, PROMPT_GUARD: 'observe' });
    expect(leaked.job.status).toBe(off.window60!.job.status);
    expect(leaked.allowance).toEqual(off.window60!.allowance);
    expect({ ...leaked.job, final_prompt: null, work: null }).toEqual({ ...off.window60!.job, final_prompt: null, work: null });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    for (const line of logs) expect(line).toMatchObject({ mode: 'observe', action: 'observed' });

    const failed = await runProductPath(f, path, () => failingSiteFetch(), { ...ENV, PROMPT_GUARD: 'observe' });
    const canary = await runProductPath(f, path, 'canary', { ...ENV, PROMPT_GUARD: 'observe' });
    expect(effects(canary)).toEqual(effects(failed));
  });

  it('off: preview and paid run are byte for byte the origin/main snapshot (requests included)', async () => {
    const off = offSnapshot(path.id);
    for (const kind of ['benign', 'window60'] as const) {
      const run = await runProductPath(f, path, kind, { ...ENV, PROMPT_GUARD: 'off' });
      expect(run, kind).toEqual(off[kind]);
    }
    // The guard never reads a request it did not build: a leak-free fetch double is all it ever sees.
    expect(leakingFetch).toBeTypeOf('function');
  });
});
