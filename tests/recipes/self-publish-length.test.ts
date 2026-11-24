import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { administerPlatform } from '@/lib/creator-platform/admin';
import { makerAction } from '@/lib/recipes/maker';
import { saveMakerProfile } from '@/lib/makers/profile';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * Founder, 2026-11-25: a template whose Seedance 2.5 clip is over 15,000 characters never reaches buyers. On the
 * creative's side the recipe rules already hold every step to its engine's limit, and both ways a creative's recipe
 * becomes a template — publishing it themself, and submitting it for the studio's acceptance (`acceptRecipe`, which
 * runs the same `parseRecipe` again) — check the recipe first. No second check is added; this confirms the first one
 * holds. Filler text only (the repo is public).
 */

const creative = viewerOf('free'), open = { creators: true };
const film = (chars: number) => {
  const head = '{{selfie}} walks down a quiet street at dusk. ';
  return {
    version: 2,
    slots: { selfie: { kind: 'image', source: 'user', required: true } },
    steps: [{ id: 'film', kind: 'video', engine: 'seedance-2.5', inputs: ['selfie'], prompt: `${head}${'x'.repeat(chars - head.length)}`, params: { aspect: '9:16', duration: 10, resolution: '720p' } }],
    output: { from: 'film' },
  };
};

async function code(run: Promise<unknown>): Promise<string> {
  try { await run; } catch (error) { return (error as { code?: string }).code ?? String(error); }
  return 'resolved';
}

describe('a creative template and the 15,000-character clip limit', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-length-'));
    store = createLocalRenderStore(root);
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: creative.userId, active: true, contract: 'pilot-v1', reason: 'Owner-approved invitation' });
    await saveMakerProfile(h.sql, creative.userId!, { handle: 'long_takes', publicProfile: true });
  });
  afterEach(async () => { vi.unstubAllEnvs(); await h.close(); await rm(root, { recursive: true, force: true }); });

  const deps = () => ({ sql: h.sql, store, storage: h.storage });
  const draft = async (chars: number) => {
    const id = randomUUID();
    await makerAction(deps(), creative, { action: 'save', id, title: 'Long take', titleKo: '긴 테이크', example: '', disclosure: { prompts: false, assets: false }, presentation: 'make-first', royalty: 2000, recipe: film(chars) }, open);
    return id;
  };

  it('refuses to publish or submit a 15,001-character clip, and lets exactly 15,000 through to the next check', async () => {
    const over = await draft(15_001);
    expect(await code(makerAction(deps(), creative, { action: 'publish', id: over, rights: true }, open))).toBe('recipe_invalid');
    expect(await code(makerAction(deps(), creative, { action: 'submit', id: over, rights: true }, open))).toBe('recipe_invalid');
    const { rows } = await h.sql.query<{ n: number }>("select count(*)::int as n from prompt_items where title = 'Long take'");
    expect(rows[0]!.n).toBe(0);

    // The recipe passes; what stops it now is the missing example file, not its length.
    const exact = await draft(15_000);
    expect(await code(makerAction(deps(), creative, { action: 'publish', id: exact, rights: true }, open))).toBe('example_file_required');
  });
});
