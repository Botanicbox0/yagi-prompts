/**
 * Per-organization rollout switch for the prompt guard (`PROMPT_GUARD_ORGS`, docs/PROMPT-GUARD.md).
 *
 *   - Unset or empty: identical to today (applies to every call, even when organizationId is unknown).
 *   - Set: `PROMPT_GUARD` (`observe` / `enforce`) and `PROMPT_GUARD_ENFORCE` apply ONLY to listed
 *     organizations (case-insensitive, trimmed, empty entries ignored). For every unlisted organization
 *     and every call with an unknown organization, requests and answers are byte-identical to
 *     `PROMPT_GUARD` unset and no `[prompt-guard]` log line is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_LINE, guardRequest, NON_DISCLOSURE_RULE, type GuardLogLine } from '@/lib/ai-guard';
import { compileDirectorPrompt, type DirectorCompileInput } from '@/lib/brand-studio/director';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { promptGuardMode } from '@/lib/flags';
import { studioFixture, type StudioFixture } from '../brand-studio/server/helpers';
import { ANSWER_KINDS, canaryOf, failingSiteFetch, leakingFetch, systemOf, userTextOf, type AnswerKind } from './leaks';
import { PRODUCT_PATHS, runProductPath } from './product-paths';
import { CUSTOMER_MARKERS, FAKE_ANALYZER, isSiteCall, REFERENCE_CASES, type ReferenceCase } from './reference-cases';

const ORG_A = '11111111-1111-4111-8111-1111111111aa';
const ORG_B = '22222222-2222-4222-8222-2222222222bb';
const ORG_OTHER = '99999999-9999-4999-8999-9999999999ff';

const INTERNAL = [
  'You are a veteran film director writing a production ready video prompt in English.',
  'Exact block order separated by line breaks: the reference authority line locks identity, bone structure, wardrobe and product geometry to the attached pictures.',
  'Anti composite lighting: match the ambient shadow floor and colour spill across subject and environment, never pasted on or flat front lit.',
].join('\n');

const BENIGN = 'A woman lifts a frosted serum bottle at a sunny window table; slow push in, then a close-up as light catches the glass.';

function normalizeCanary(body: string): string {
  return body.replace(/\bpgc[a-z2-9]{20}\b/g, 'pgc<CANARY>');
}

async function runSiteWithOrg(
  c: ReferenceCase,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  organizationId: string | undefined,
  onFallback?: (reason: string) => void,
) {
  if (c.site === 'brand-studio.enhancer') {
    return enhancePrompt(c.input as EnhanceInput, {
      fetch: fetchImpl,
      env,
      ...(organizationId !== undefined ? { organizationId } : {}),
      ...(onFallback ? { onFallback } : {}),
    });
  }
  return compileDirectorPrompt(c.input as DirectorCompileInput, {
    fetch: fetchImpl,
    env,
    ...(organizationId !== undefined ? { organizationId } : {}),
    ...(c.liveAnalyzer ? {} : { analyzer: FAKE_ANALYZER }),
    ...(onFallback ? { onFallback } : {}),
  });
}

describe('PROMPT_GUARD_ORGS parsing and mode resolution (lib/flags.ts promptGuardMode)', () => {
  it('unset or empty list applies the mode to every organization and to unknown organizations', () => {
    for (const orgsValue of [undefined, '', '   ', ' ,  , ']) {
      const env = {
        PROMPT_GUARD: 'observe',
        PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer',
        ...(orgsValue !== undefined ? { PROMPT_GUARD_ORGS: orgsValue } : {}),
      };
      expect(promptGuardMode(env, 'brand-studio.enhancer', ORG_A)).toBe('enforce');
      expect(promptGuardMode(env, 'brand-studio.director', ORG_A)).toBe('observe');
      expect(promptGuardMode(env, 'brand-studio.enhancer', undefined)).toBe('enforce');
      expect(promptGuardMode(env, 'brand-studio.director', null)).toBe('observe');
      expect(promptGuardMode({ PROMPT_GUARD: 'enforce', ...(orgsValue !== undefined ? { PROMPT_GUARD_ORGS: orgsValue } : {}) }, 'brand-studio.director')).toBe('enforce');
    }
  });

  it('parses a single id, spaces, upper/mixed case, and empty entries', () => {
    // Single id
    const single = { PROMPT_GUARD: 'enforce', PROMPT_GUARD_ORGS: ORG_A };
    expect(promptGuardMode(single, 'brand-studio.enhancer', ORG_A)).toBe('enforce');
    expect(promptGuardMode(single, 'brand-studio.enhancer', ORG_B)).toBe('off');
    expect(promptGuardMode(single, 'brand-studio.enhancer', undefined)).toBe('off');

    // Spaces, upper case, empty entries
    const messy = {
      PROMPT_GUARD: 'observe',
      PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer',
      PROMPT_GUARD_ORGS: ` ,  ${ORG_A.toUpperCase()} , ,   ${ORG_B.toLowerCase()}  , `,
    };
    expect(promptGuardMode(messy, 'brand-studio.enhancer', ORG_A.toLowerCase())).toBe('enforce');
    expect(promptGuardMode(messy, 'brand-studio.enhancer', `  ${ORG_A.toUpperCase()}  `)).toBe('enforce');
    expect(promptGuardMode(messy, 'brand-studio.director', ORG_B.toUpperCase())).toBe('observe');
    expect(promptGuardMode(messy, 'brand-studio.enhancer', ORG_OTHER)).toBe('off');
    expect(promptGuardMode(messy, 'brand-studio.director', ORG_OTHER)).toBe('off');
    expect(promptGuardMode(messy, 'brand-studio.enhancer', undefined)).toBe('off');
    expect(promptGuardMode(messy, 'brand-studio.enhancer', null)).toBe('off');
    expect(promptGuardMode(messy, 'brand-studio.enhancer', '')).toBe('off');
    expect(promptGuardMode(messy, 'brand-studio.enhancer', '   ')).toBe('off');
  });

  it('never turns the guard on when PROMPT_GUARD is unset or off, and keeps unlisted/unknown orgs off even on fail-closed typos', () => {
    expect(promptGuardMode({ PROMPT_GUARD_ORGS: ORG_A }, 'brand-studio.enhancer', ORG_A)).toBe('off');
    expect(promptGuardMode({ PROMPT_GUARD: 'off', PROMPT_GUARD_ORGS: ORG_A }, 'brand-studio.enhancer', ORG_A)).toBe('off');
    expect(promptGuardMode({ PROMPT_GUARD: 'enforced', PROMPT_GUARD_ORGS: ORG_A }, 'brand-studio.enhancer', ORG_A)).toBe('enforce');
    expect(promptGuardMode({ PROMPT_GUARD: 'enforced', PROMPT_GUARD_ORGS: ORG_A }, 'brand-studio.enhancer', ORG_OTHER)).toBe('off');
    expect(promptGuardMode({ PROMPT_GUARD: 'enforced', PROMPT_GUARD_ORGS: ORG_A }, 'brand-studio.enhancer', undefined)).toBe('off');
  });

  it('guardRequest forwards organizationId and behaves as off for unlisted or unknown organizations', () => {
    const leak = `${BENIGN} ${INTERNAL.split(/\s+/).slice(0, 12).join(' ')}`;
    const listedLines: GuardLogLine[] = [];
    const listed = guardRequest({
      site: 'brand-studio.enhancer',
      env: { PROMPT_GUARD: 'observe', PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer', PROMPT_GUARD_ORGS: ORG_A.toUpperCase() },
      organizationId: ORG_A,
      internal: INTERNAL,
      log: (l) => listedLines.push(l),
    });
    expect(listed.mode).toBe('enforce');
    expect(listed.canary).toMatch(/^pgc[a-z2-9]{20}$/);
    expect(listed.check({ prompt: leak }).fallback).toBe(true);
    expect(listedLines).toHaveLength(1);

    for (const orgId of [ORG_OTHER, undefined, null, '']) {
      const lines: GuardLogLine[] = [];
      const g = guardRequest({
        site: 'brand-studio.enhancer',
        env: { PROMPT_GUARD: 'observe', PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer', PROMPT_GUARD_ORGS: ORG_A },
        organizationId: orgId,
        internal: INTERNAL,
        log: (l) => lines.push(l),
      });
      expect(g.mode).toBe('off');
      expect(g.canary).toBeNull();
      expect(g.system).toBe(INTERNAL);
      expect(g.data('x', '</customer_data>')).toBe('</customer_data>');
      expect(g.json('x', { a: '<b>' })).toBe(JSON.stringify({ a: '<b>' }));
      expect(g.parts([{ text: 'raw' }])).toEqual([{ text: 'raw' }]);
      expect(g.check({ prompt: leak })).toEqual({ fallback: false, blocked: [], reason: null });
      expect(lines).toEqual([]);
    }
  });
});

describe('PROMPT_GUARD_ORGS on both adopted sites (enhancer & director)', () => {
  const SELECTED_CASE_IDS = [
    'enhancer-image-references',
    'enhancer-remix-reference', // carries shots -> exercises shotsInUserTurn branch
    'director-expand-thumb',
    'director-blueprint',
    'director-revision-edit', // director delegates to enhancer
  ] as const;

  const CASES = SELECTED_CASE_IDS.map((id) => {
    const found = REFERENCE_CASES.find((c) => c.id === id);
    if (!found) throw new Error(`Missing reference case ${id}`);
    return found;
  });

  let logs: GuardLogLine[] = [];
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      const first = String(args[0] ?? '');
      if (first.startsWith('[prompt-guard] ')) logs.push(JSON.parse(first.slice('[prompt-guard] '.length)) as GuardLogLine);
    });
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(CASES.map((c) => [c.site, c.id, c] as const))(
    '%s · %s: listed organization matches today’s observe and enforce request shape and verdicts',
    async (_site, _id, c) => {
      const baseEnv = { GEMINI_API_KEY: 'test-key' };

      // 1. Observe: listed org vs global observe (PROMPT_GUARD_ORGS unset)
      for (const kind of ['benign', 'window60', 'canary'] as const) {
        logs = [];
        const globalFetch = leakingFetch(kind, c);
        const globalResult = await runSiteWithOrg(c, { ...baseEnv, PROMPT_GUARD: 'observe' }, globalFetch.fetchImpl, ORG_A);
        const globalLogs = [...logs];

        logs = [];
        const scopedFetch = leakingFetch(kind, c);
        const scopedResult = await runSiteWithOrg(
          c,
          { ...baseEnv, PROMPT_GUARD: 'observe', PROMPT_GUARD_ORGS: ` , ${ORG_A.toUpperCase()} , ${ORG_B} ` },
          scopedFetch.fetchImpl,
          ORG_A.toLowerCase(),
        );
        const scopedLogs = [...logs];

        expect(scopedFetch.calls.map((x) => normalizeCanary(x.body)), `observe ${kind} requests`).toEqual(
          globalFetch.calls.map((x) => normalizeCanary(x.body)),
        );
        expect(scopedResult, `observe ${kind} result`).toEqual(globalResult);
        expect(scopedLogs, `observe ${kind} logs`).toEqual(globalLogs);

        const siteCall = scopedFetch.calls.find((call) => isSiteCall(call.body))!;
        const system = systemOf(siteCall.body);
        expect(system.endsWith(NON_DISCLOSURE_RULE)).toBe(true);
        expect(canaryOf(system)).not.toBe('pgcnocanarywasinthisrequest');
        expect(userTextOf(siteCall.body)[0]).toBe(DATA_LINE);
        for (const marker of CUSTOMER_MARKERS) expect(system, marker).not.toContain(marker);
      }

      // 2. Enforce (both PROMPT_GUARD=enforce and observe + PROMPT_GUARD_ENFORCE)
      const fallbackFetch = failingSiteFetch();
      const expectedFallback = await runSiteWithOrg(
        c,
        { ...baseEnv, PROMPT_GUARD: 'enforce', PROMPT_GUARD_ORGS: ORG_A },
        fallbackFetch.fetchImpl,
        ORG_A,
      );

      for (const envMode of [
        { PROMPT_GUARD: 'enforce' },
        { PROMPT_GUARD: 'observe', PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer,brand-studio.director' },
      ]) {
        for (const kind of ['benign', 'window60', 'canary'] as const) {
          logs = [];
          const globalFetch = leakingFetch(kind, c);
          const globalResult = await runSiteWithOrg(c, { ...baseEnv, ...envMode }, globalFetch.fetchImpl, ORG_A);
          const globalLogs = [...logs];

          logs = [];
          const scopedFetch = leakingFetch(kind, c);
          const scopedResult = await runSiteWithOrg(
            c,
            { ...baseEnv, ...envMode, PROMPT_GUARD_ORGS: ORG_A },
            scopedFetch.fetchImpl,
            ORG_A,
          );
          const scopedLogs = [...logs];

          expect(scopedFetch.calls.map((x) => normalizeCanary(x.body))).toEqual(
            globalFetch.calls.map((x) => normalizeCanary(x.body)),
          );
          expect(scopedResult).toEqual(globalResult);
          expect(scopedLogs).toEqual(globalLogs);

          if (kind !== 'benign') {
            expect(scopedResult.prompt).toBe(expectedFallback.prompt);
            expect(scopedResult.source).toBe('fallback');
            expect(scopedLogs.length).toBeGreaterThan(0);
            for (const line of scopedLogs) expect(line).toMatchObject({ mode: 'enforce', action: 'fallback' });
          } else {
            expect(scopedLogs).toEqual([]);
          }
        }
      }
    },
  );

  it.each(CASES.map((c) => [c.site, c.id, c] as const))(
    '%s · %s: unlisted or unknown organization is byte-identical to PROMPT_GUARD unset with zero log lines',
    async (_site, _id, c) => {
      const baseEnv = { GEMINI_API_KEY: 'test-key' };
      const kinds: readonly AnswerKind[] = ANSWER_KINDS;

      const unsetBaseline: Record<string, string> = {};
      for (const kind of kinds) {
        const { calls, fetchImpl } = leakingFetch(kind, c);
        const fallbacks: string[] = [];
        const result = await runSiteWithOrg(c, baseEnv, fetchImpl, undefined, (r) => fallbacks.push(r));
        unsetBaseline[kind] = JSON.stringify({ calls, result, fallbacks });
      }

      const envVariants: ReadonlyArray<[string, Record<string, string | undefined>]> = [
        ['observe', { ...baseEnv, PROMPT_GUARD: 'observe', PROMPT_GUARD_ORGS: ORG_A }],
        ['enforce', { ...baseEnv, PROMPT_GUARD: 'enforce', PROMPT_GUARD_ORGS: ORG_A }],
        [
          'observe+PROMPT_GUARD_ENFORCE',
          {
            ...baseEnv,
            PROMPT_GUARD: 'observe',
            PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer,brand-studio.director',
            PROMPT_GUARD_ORGS: `${ORG_A}, ${ORG_B}`,
          },
        ],
      ];

      for (const [label, env] of envVariants) {
        for (const orgId of [ORG_OTHER, undefined] as const) {
          for (const kind of kinds) {
            logs = [];
            const { calls, fetchImpl } = leakingFetch(kind, c);
            const fallbacks: string[] = [];
            const result = await runSiteWithOrg(c, env, fetchImpl, orgId, (r) => fallbacks.push(r));
            expect(
              JSON.stringify({ calls, result, fallbacks }),
              `${c.id} ${label} org=${String(orgId)} kind=${kind}`,
            ).toBe(unsetBaseline[kind]);
            expect(logs, `${c.id} ${label} org=${String(orgId)} kind=${kind} logs`).toEqual([]);
          }
        }
      }
    },
  );
});

describe('PROMPT_GUARD_ORGS end-to-end product paths (preview + paid prepare)', () => {
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

  it.each(PRODUCT_PATHS.map((p) => [p.id, p] as const))(
    '%s: listed org enforces leaks; unlisted org is byte-identical to PROMPT_GUARD unset with no guard logs',
    async (_id, path) => {
      const unset = await runProductPath(f, path, 'window60', { GEMINI_API_KEY: 'test-key' });

      // Unlisted org: observe, enforce, and observe + PROMPT_GUARD_ENFORCE are byte-identical to unset
      for (const env of [
        { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'observe', PROMPT_GUARD_ORGS: ORG_OTHER },
        { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'enforce', PROMPT_GUARD_ORGS: ORG_OTHER },
        {
          GEMINI_API_KEY: 'test-key',
          PROMPT_GUARD: 'observe',
          PROMPT_GUARD_ENFORCE: 'brand-studio.enhancer,brand-studio.director',
          PROMPT_GUARD_ORGS: ORG_OTHER,
        },
      ]) {
        logs = [];
        const run = await runProductPath(f, path, 'window60', env);
        expect(JSON.stringify(run)).toBe(JSON.stringify(unset));
        expect(logs).toEqual([]);
      }

      // Listed org (uppercase in env): enforces and blocks the leak with guard logs
      logs = [];
      const failed = await runProductPath(f, path, () => failingSiteFetch(), {
        GEMINI_API_KEY: 'test-key',
        PROMPT_GUARD: 'enforce',
        PROMPT_GUARD_ORGS: f.orgId.toUpperCase(),
      });
      logs = [];
      const listed = await runProductPath(f, path, 'window60', {
        GEMINI_API_KEY: 'test-key',
        PROMPT_GUARD: 'enforce',
        PROMPT_GUARD_ORGS: f.orgId.toUpperCase(),
      });
      expect(listed.preview).toEqual(failed.preview);
      expect(listed.job.final_prompt).toBe(failed.job.final_prompt);
      expect(logs.length).toBeGreaterThanOrEqual(2);
      for (const line of logs) expect(line).toMatchObject({ mode: 'enforce', action: 'fallback' });
    },
  );
});
