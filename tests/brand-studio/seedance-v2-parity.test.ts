import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileDirectorPrompt, composeDirectorFallbackPrompt } from '@/lib/brand-studio/director';
import { composeFallbackPrompt, enhancePrompt } from '@/lib/brand-studio/enhancer';
import { referenceClause } from '@/lib/brand-studio/enhancer/lines';
import { PROFILE_HEADERS, profileVersionOf } from '@/lib/brand-studio/enhancer/profiles';
import { SEEDANCE_HEADER, SEEDANCE_PROFILE } from '@/lib/brand-studio/enhancer/profiles/seedance';
import {
  CLIP_REVISION_ENHANCER_PARITY_INPUT,
  CLIP_REVISION_ENHANCER_PARITY_MOCK_ANSWER,
  FIXED_ANALYZER,
  REVISION_ENHANCER_FALLBACK_EDIT_INPUT,
  REVISION_ENHANCER_FALLBACK_RESHOOT_INPUT,
  SEEDANCE_PARITY_CASES,
  type SeedanceParityCase,
} from './seedance-v2-fixtures';

interface RecordedRequest {
  url: string;
  systemText: string;
  userTexts: string[];
}

function captureFetch(c: SeedanceParityCase) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = String(init?.body ?? '{}');
    const parsed = JSON.parse(raw) as {
      systemInstruction?: { parts?: Array<{ text?: string }> };
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };
    const systemText = (parsed.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('');
    const userTexts = (parsed.contents ?? []).flatMap((item) =>
      (item.parts ?? []).map((p) => p.text).filter((t): t is string => typeof t === 'string'),
    );
    requests.push({ url: String(url), systemText, userTexts });
    if (c.failModel) {
      return new Response('server down', { status: 500 });
    }
    return new Response(
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(c.mockAnswer) }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { requests, fetchImpl };
}

async function runSnapshot(c: SeedanceParityCase, env: Record<string, string | undefined>) {
  const { requests, fetchImpl } = captureFetch(c);
  const compiled = await compileDirectorPrompt(c.input, {
    fetch: fetchImpl,
    env,
    analyzer: FIXED_ANALYZER,
  });
  const fallback = composeDirectorFallbackPrompt(c.input, {
    analysis: compiled.analysis,
  });
  return `${JSON.stringify(
    {
      id: c.id,
      label: c.label,
      intent: compiled.intent,
      directorRequests: requests,
      compiledResult: {
        prompt: compiled.prompt,
        notes: compiled.notes,
        source: compiled.source,
        intent: compiled.intent,
        provider: compiled.provider,
        playbooksApplied: compiled.playbooksApplied,
        ...(compiled.meta ? { meta: compiled.meta } : {}),
      },
      fallbackResult: {
        prompt: fallback.prompt,
        notes: fallback.notes,
        source: fallback.source,
      },
      profileVersion: profileVersionOf('seedance', 'seedance-2.5'),
    },
    null,
    2,
  )}\n`;
}

function profileAndLinesSnapshot() {
  const personRef = {
    ref: { index: 1, kind: 'image' as const, label: '이미지 1', role: 'person' as const, use: '얼굴 유지', avoid: '배경' },
    position: 1,
    ordinal: 1,
    token: '@Image1',
    name: 'the reference picture',
  };
  const productRef = {
    ref: { index: 1, kind: 'image' as const, label: '이미지 1', role: 'product' as const },
    position: 1,
    ordinal: 1,
    token: '@Image1',
    name: 'the reference picture',
  };
  return `${JSON.stringify(
    {
      seedanceHeader: SEEDANCE_HEADER,
      profileHeaderEntry: PROFILE_HEADERS.seedance,
      profileVersion: profileVersionOf('seedance', 'seedance-2.5'),
      seedanceProfile: SEEDANCE_PROFILE,
      referenceClauses: {
        seedancePerson: referenceClause('seedance', personRef),
        seedreamPerson: referenceClause('seedream', { ...personRef, token: 'Image 1' }),
        nanoBananaPerson: referenceClause('nano-banana', { ...personRef, token: 'image 1' }),
        seedanceProduct: referenceClause('seedance', productRef),
      },
    },
    null,
    2,
  )}\n`;
}

async function expectExistingFileSnapshot(actual: string, relPath: string) {
  const updateMode = (expect.getState().snapshotState as unknown as { _updateSnapshot?: string } | undefined)?._updateSnapshot;
  if (updateMode !== 'all') {
    const abs = fileURLToPath(new URL(relPath, import.meta.url));
    if (!existsSync(abs)) {
      throw new Error(`snapshot missing: ${relPath}`);
    }
  }
  await expect(actual).toMatchFileSnapshot(relPath);
}

describe('BRAND_SEEDANCE_RULES_V2 unset/off parity snapshots (byte-identical to origin/main)', () => {
  it.each(SEEDANCE_PARITY_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const unset = await runSnapshot(c, { GEMINI_API_KEY: 'test-key' });
    await expect(unset).toMatchFileSnapshot(`./__snapshots__/seedance-v2-off/${c.id}.json`);

    // Explicit off and empty string match the unset snapshot byte-for-byte.
    const explicitOff = await runSnapshot(c, { GEMINI_API_KEY: 'test-key', BRAND_SEEDANCE_RULES_V2: 'off' });
    const emptyOff = await runSnapshot(c, { GEMINI_API_KEY: 'test-key', BRAND_SEEDANCE_RULES_V2: '' });
    expect(explicitOff).toBe(unset);
    expect(emptyOff).toBe(unset);
  });

  it('08-very-long-brief routes through the director (slot_fill), not passthrough', async () => {
    const longCase = SEEDANCE_PARITY_CASES.find((c) => c.id === '08-very-long-brief')!;
    const { requests, fetchImpl } = captureFetch(longCase);
    const compiled = await compileDirectorPrompt(longCase.input, {
      fetch: fetchImpl,
      env: { GEMINI_API_KEY: 'test-key' },
      analyzer: FIXED_ANALYZER,
    });
    expect(compiled.intent).toBe('slot_fill');
    expect(requests).toHaveLength(1);
  });

  it('SEEDANCE_PROFILE and person reference lines match origin/main when switch is unset', async () => {
    await expect(profileAndLinesSnapshot()).toMatchFileSnapshot('./__snapshots__/seedance-v2-off/profile-and-lines.json');
  });

  it('09-clip-revision-enhancer: clip revision request through enhancePrompt', async () => {
    const mockCase = { mockAnswer: CLIP_REVISION_ENHANCER_PARITY_MOCK_ANSWER };
    const runEnhancerRev = async (env: Record<string, string | undefined>) => {
      const { requests, fetchImpl } = captureFetch(mockCase as SeedanceParityCase);
      const result = await enhancePrompt(CLIP_REVISION_ENHANCER_PARITY_INPUT, {
        fetch: fetchImpl,
        env,
      });
      return `${JSON.stringify({ requests, result }, null, 2)}\n`;
    };
    const unset = await runEnhancerRev({ GEMINI_API_KEY: 'test-key' });
    expect(await runEnhancerRev({ GEMINI_API_KEY: 'test-key', BRAND_SEEDANCE_RULES_V2: 'off' })).toBe(unset);
    expect(await runEnhancerRev({ GEMINI_API_KEY: 'test-key', BRAND_SEEDANCE_RULES_V2: '' })).toBe(unset);
    await expectExistingFileSnapshot(unset, './__snapshots__/seedance-v2-off/09-clip-revision-enhancer.json');
  });

  it('10-revision-enhancer-fallback: enhancer fallback for a clip revision', async () => {
    const editFallback = composeFallbackPrompt(REVISION_ENHANCER_FALLBACK_EDIT_INPUT);
    const reshootFallback = composeFallbackPrompt(REVISION_ENHANCER_FALLBACK_RESHOOT_INPUT);
    const snapshot = `${JSON.stringify({ editFallback, reshootFallback }, null, 2)}\n`;
    await expectExistingFileSnapshot(snapshot, './__snapshots__/seedance-v2-off/10-revision-enhancer-fallback.json');
  });
});
