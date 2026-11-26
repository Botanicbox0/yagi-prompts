import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T>(fn: T) => fn,
}));

import { activateOpenMaker } from '@/lib/makers/self-activate';
import { handleMcp, recipeGuide } from '@/lib/mcp/server';
import { parseRecipe, recipeShapeHints } from '@/lib/recipes/schema';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

const CREATIVE = viewerOf('free');
const REAL_ASSET = `ast_${'b'.repeat(32)}`;

function replacePlaceholderAssets(recipe: unknown): unknown {
  return JSON.parse(JSON.stringify(recipe).replace(/ast_<32 hex from upload_file>/g, REAL_ASSET));
}

describe('recipeShapeHints', () => {
  it('returns an upload_file hint on .asset for guide example and exampleWithClips unchanged', () => {
    const guide = recipeGuide();
    expect(guide.notes).toContain('upload_file');
    expect(guide.notes).toMatch(/ast_/);

    for (const [label, sample] of [
      ['example', guide.example],
      ['exampleWithClips', guide.exampleWithClips],
    ] as const) {
      const hints = recipeShapeHints(sample);
      expect(hints.length, label).toBeGreaterThan(0);
      expect(hints[0], label).toMatch(/^[^:]+\.asset: /);
      expect(hints[0], label).toContain('upload_file');
      expect(hints[0], label).toContain('ast_');
      for (const hint of hints) {
        expect(hint.length).toBeLessThanOrEqual(160);
      }
    }
  });

  it('returns no hints and validates cleanly once placeholder assets are replaced with real ast_ ids', () => {
    const guide = recipeGuide();
    for (const sample of [guide.example, guide.exampleWithClips]) {
      const real = replacePlaceholderAssets(sample);
      expect(recipeShapeHints(real)).toEqual([]);
      expect(parseRecipe(real)).toMatchObject({ ok: true });
    }
  });

  it('names steps when steps array is empty and handles invalid JSON strings', () => {
    expect(recipeShapeHints('{bad json')).toEqual(['recipe: not valid JSON']);

    const hints = recipeShapeHints({
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [],
      output: { from: 'still' },
    });
    expect(hints.some((hint) => hint.startsWith('steps:'))).toBe(true);
  });

  it('never echoes long prompt text or long input values and caps at 8 hints of <= 160 chars', () => {
    const secretLongPrompt = `UNIQUE_PROMPT_MARKER_${'z'.repeat(16_000)}`;
    const longUnexpectedKey = `unexpected_key_${'k'.repeat(80)}`;
    const hints = recipeShapeHints({
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [
        {
          id: 'still',
          kind: 'image',
          engine: 'gpt-image-2',
          inputs: ['selfie'],
          prompt: secretLongPrompt,
          params: { aspect: '9:16' },
        },
      ],
      output: { from: 'still' },
      [longUnexpectedKey]: 'ignored',
    });

    expect(hints.length).toBeGreaterThan(0);
    expect(hints.length).toBeLessThanOrEqual(8);
    for (const hint of hints) {
      expect(hint.length).toBeLessThanOrEqual(160);
      expect(hint).not.toContain('UNIQUE_PROMPT_MARKER_');
      expect(hint).not.toContain('zzzzzzzz');
      expect(hint).not.toContain(longUnexpectedKey);
    }

    const manyBrokenSlots = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`ref_${i}`, { kind: 'image', source: 'creator', asset: 'bad' }]),
    );
    const capped = recipeShapeHints({
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true }, ...manyBrokenSlots },
      steps: [],
      output: {},
    });
    expect(capped).toHaveLength(8);
    for (const hint of capped) {
      expect(hint.length).toBeLessThanOrEqual(160);
    }
  });
});

describe('MCP validate_recipe and save_template shape hints', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;

  const call = (name: string, args: Record<string, unknown> = {}) =>
    handleMcp(
      { sql: h.sql, store, userId: CREATIVE.userId!, origin: 'https://twings.app' },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    );
  const payload = (response: unknown) =>
    JSON.parse((response as { result: { content: Array<{ text: string }> } }).result.content[0]!.text);

  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-mcp-hints-'));
    store = createLocalRenderStore(root);
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('attaches hints to validate_recipe and save_template on bare shape issues and omits hints when valid', async () => {
    const guide = recipeGuide();

    const valBad = payload(await call('validate_recipe', { recipe: guide.example }));
    expect(valBad).toMatchObject({ ok: false, issues: [{ code: 'shape' }] });
    expect(valBad.hints).toEqual([
      expect.stringMatching(/^slots\.scene\.asset: .*upload_file/),
    ]);

    const valBadClips = payload(await call('validate_recipe', { recipe: guide.exampleWithClips }));
    expect(valBadClips).toMatchObject({ ok: false, issues: [{ code: 'shape' }] });
    expect(valBadClips.hints).toEqual([
      expect.stringMatching(/^slots\.wardrobe\.asset: .*upload_file/),
    ]);

    const savedBad = payload(await call('save_template', { title: 'Unresolved guide example', recipe: guide.example }));
    expect(savedBad).toMatchObject({
      saved: true,
      complete: false,
      issues: [{ code: 'shape' }],
    });
    expect(savedBad.hints).toEqual([
      expect.stringMatching(/^slots\.scene\.asset: .*upload_file/),
    ]);

    const validExample = replacePlaceholderAssets(guide.example);
    const valGood = payload(await call('validate_recipe', { recipe: validExample }));
    expect(valGood).toEqual({ ok: true, medium: 'video' });
    expect(valGood.hints).toBeUndefined();

    const savedGood = payload(await call('save_template', { id: savedBad.id, title: 'Resolved guide example', recipe: validExample }));
    expect(savedGood).toMatchObject({ saved: true, complete: true, issues: [] });
    expect(savedGood.hints).toBeUndefined();
  });

  it('omits hints when shape issue is step-scoped (prompt over engine limit, valid RecipeShape)', async () => {
    const overImageLimit = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [
        {
          id: 'still',
          kind: 'image',
          engine: 'gpt-image-2',
          inputs: ['selfie'],
          prompt: `Portrait of {{selfie}} ${'a'.repeat(8_200)}`,
          params: { aspect: '9:16' },
        },
      ],
      output: { from: 'still' },
    };

    const res = payload(await call('validate_recipe', { recipe: overImageLimit }));
    expect(res).toEqual({ ok: false, issues: [{ code: 'shape', step: 'still' }] });
    expect(res.hints).toBeUndefined();
  });
});
