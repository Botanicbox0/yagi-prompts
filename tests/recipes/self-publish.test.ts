import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { administerPlatform } from '@/lib/creator-platform/admin';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { makerAction, uploadMakerFile } from '@/lib/recipes/maker';
import { quoteRecipe } from '@/lib/recipes/pricing';
import { loadPublicRecipe, recipeTeaser } from '@/lib/recipes/public';
import { parseRecipe } from '@/lib/recipes/schema';
import { selfPublishSlug } from '@/lib/recipes/self-publish';
import { saveMakerProfile } from '@/lib/makers/profile';
import { loadPromptCatalog } from '@/lib/prompts/catalog';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * docs/PLATFORM-2.0.md §20.6 — an AI creative publishes their own template with no studio review.
 * The machine checks stand in for the human: a passing recipe, an uploaded example file, the
 * rights confirmation and one succeeded test render with the creative's own face. The price is the
 * floor plus their royalty, never typed by anyone.
 */

const creative = viewerOf('free'), open = { creators: true };
const png = (side = 320) => sharp({ create: { width: side, height: side, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer().then((b) => new Uint8Array(b));
const recipe = {
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'A studio portrait of {{selfie}} in soft window light.', params: { aspect: '4:5' } }],
  output: { from: 'step1' },
  notes: { intro: 'One still from one selfie.' },
};

async function code(run: Promise<unknown>): Promise<string> {
  try { await run; } catch (error) { return (error as { code?: string }).code ?? String(error); }
  return 'resolved';
}

describe('self-publish (§20.6)', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-publish-'));
    store = createLocalRenderStore(root);
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: creative.userId, active: true, contract: 'pilot-v1', reason: 'Owner-approved invitation' });
    await saveMakerProfile(h.sql, creative.userId!, { handle: 'soft_light', publicProfile: true });
  });
  afterEach(async () => { vi.unstubAllEnvs(); await h.close(); await rm(root, { recursive: true, force: true }); });

  const deps = () => ({ sql: h.sql, store, storage: h.storage });
  const draft = async () => {
    const id = randomUUID();
    await makerAction(deps(), creative, { action: 'save', id, title: 'Soft Window — Light!', titleKo: '창가 빛', example: '', disclosure: { prompts: true, assets: false }, presentation: 'make-first', royalty: 2000, recipe }, open);
    return id;
  };
  const succeededTest = async (id: string) => {
    await saveSelfie({ sql: h.sql, store }, creative.userId!, { bytes: await png(), mime: 'image/png', consent: true });
    const { renderId } = await makerAction(deps(), creative, { action: 'test', id }, open);
    await h.sql.query("update render_jobs set status='succeeded',result_key=$2,result_mime='image/jpeg',share_token=id::text,share_expires_at=now(),finished_at=now() where id=$1", [renderId, `${renderId}/result.jpg`]);
  };

  it('refuses until every machine check passes, then publishes at floor + royalty with the example as the card', async () => {
    const id = await draft();
    const publish = () => makerAction(deps(), creative, { action: 'publish', id, rights: true }, open);
    expect(await code(publish())).toBe('example_file_required');
    await uploadMakerFile(deps(), creative, { formatId: id, role: 'example', bytes: await png(640) }, open);
    expect(await code(publish())).toBe('test_required');
    // A test that is still running (or failed) does not count.
    await saveSelfie({ sql: h.sql, store }, creative.userId!, { bytes: await png(), mime: 'image/png', consent: true });
    await makerAction(deps(), creative, { action: 'test', id }, open);
    expect(await code(publish())).toBe('test_required');
    await succeededTest(id);
    expect(await code(makerAction(deps(), creative, { action: 'publish', id }, open))).toBe('invalid');
    // Someone else cannot publish it.
    expect(await code(makerAction(deps(), viewerOf('pro'), { action: 'publish', id, rights: true }, open))).not.toBe('resolved');

    const published = await publish();
    const checked = parseRecipe(recipe);
    if (!checked.ok) throw new Error('fixture recipe must pass');
    const expectedPrice = quoteRecipe(checked.recipe, 2000).proposedKrw;
    expect(published).toMatchObject({ id, priceKrw: expectedPrice, slug: expect.stringMatching(/^soft-window-light-[0-9a-f]{6}$/) });

    const catalog = await loadPromptCatalog(h.sql, { publicUrl: (key) => `https://cdn.test/${key}` });
    const card = catalog.image.find((item) => item.slug === published.slug)!;
    expect(card).toMatchObject({ origin: 'maker', authorHandle: 'soft_light', makerProfile: true, priceKrw: expectedPrice, medium: 'image', titleKo: '창가 빛' });
    // The uploaded example was re-encoded on upload (metadata stripped), so its public copy is a JPEG.
    expect(card.poster?.src).toMatch(/^https:\/\/cdn\.test\/[0-9a-f]{64}\.jpg$/);
    expect(catalog.community.filter((item) => item.authorHandle === 'soft_light').map((item) => item.slug)).toContain(published.slug);

    // The recipe travelled with it: the teaser is public, the full prompts stay for members.
    const teaser = recipeTeaser((await loadPublicRecipe(h.sql, published.templateId!, { selfie: 'My photo', reference: 'Reference {n}', step: 'Step {n} result' }))!);
    expect(teaser).toMatchObject({ intro: 'One still from one selfie.', steps: [{ n: 1, kind: 'image' }] });

    // Twice is the same template, and the format is frozen like an accepted one.
    expect(await publish()).toMatchObject({ templateId: published.templateId, slug: published.slug });
    expect((await h.sql.query<{ status: string }>('select status from platform_formats where id=$1', [id])).rows[0]!.status).toBe('accepted');
    await expect(h.sql.query("update prompt_items set recipe=null where id=$1", [published.templateId])).rejects.toThrow('platform private format contract');
  });

  it('is closed when the kill switch is off — the review path stays', async () => {
    vi.stubEnv('TWINGS_MAKER_SELF_PUBLISH', 'off');
    const id = await draft();
    expect(await code(makerAction(deps(), creative, { action: 'publish', id, rights: true }, open))).toBe('not_open');
  });

  it('makes readable, URL-safe slugs', () => {
    expect(selfPublishSlug('Neon Diner — Night!', '1a2b3c4d-0000-4000-8000-000000000000')).toBe('neon-diner-night-1a2b3c');
    expect(selfPublishSlug('창가 빛', 'abcdef01-0000-4000-8000-000000000000')).toBe('template-abcdef');
  });
});
