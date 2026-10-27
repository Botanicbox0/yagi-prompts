import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { administerPlatform } from '@/lib/creator-platform/admin';
import { platformHome } from '@/lib/creator-platform/service';
import { loadCreatorWorkspace } from '@/lib/creator-platform/onboarding';
import { makerAction, uploadMakerFile } from '@/lib/recipes/maker';
import { loadReviewEntries, startReviewRenders, REVIEW_RENDERS } from '@/lib/recipes/review';
import { loadJobRecipe, loadTemplateRecipe } from '@/lib/recipes/repo';
import { loadPublicRecipe } from '@/lib/recipes/public';
import { makerFileObject } from '@/lib/recipes/media';
import { loadPromptCatalog } from '@/lib/prompts/catalog';
import { loadPromptById } from '@/lib/prompts/repo';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { HowItWasMade } from '@/components/recipes/how-it-was-made';
import { en } from '@/messages/en';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import sharp from 'sharp';

/**
 * The studio review (platform.review), the acceptance that copies a recipe onto a pending template,
 * the trigger that freezes it, and the public canary: a recipe the maker kept private never reaches
 * the catalogue DTO, the public projection, or the HTML rendered from it.
 */

const maker = viewerOf('free'), open = { creators: true };
const CANARY = 'RECIPE_CANARY_7f3a_never_public';
const png = (side = 320) => sharp({ create: { width: side, height: side, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer().then((b) => new Uint8Array(b));
const labels = { selfie: 'My photo', reference: 'Reference {n}', step: 'Step {n} result' };

describe('studio review and acceptance of a maker recipe', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-review-'));
    store = createLocalRenderStore(root);
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: maker.userId, active: true, contract: 'pilot-v1', reason: 'Owner-approved invitation' });
  });
  afterEach(async () => { await h.close(); await rm(root, { recursive: true, force: true }); });

  async function submitted(disclosure = { prompts: false, assets: false }) {
    const id = randomUUID(), deps = { sql: h.sql, store };
    const base = { action: 'save', id, title: 'Neon diner', titleKo: '네온 다이너', example: 'https://www.instagram.com/reel/abc123/', disclosure, presentation: 'story-first', royalty: 2000 };
    await makerAction(deps, maker, { ...base, recipe: { version: 2, slots: { selfie: { kind: 'image', source: 'user', required: true } }, steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'x placeholder {{selfie}}', params: { aspect: '4:5' } }], output: { from: 'step1' } } }, open);
    const file = await uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: await png() }, open);
    const recipe = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true }, prop: { kind: 'image', source: 'creator', asset: file.id } },
      steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie', 'prop'], prompt: `${CANARY}: {{selfie}} in a neon diner holding {{prop}}.`, params: { aspect: '4:5' } }],
      output: { from: 'step1' },
    };
    await makerAction(deps, maker, { ...base, recipe }, open);
    await makerAction(deps, maker, { action: 'submit', id, rights: true }, open);
    return { id, file };
  }
  const faces = async () => [await png(300), await png(310), await png(320), await png(330)].map((bytes) => ({ bytes, mime: 'image/png' as const }));

  it('starts three review renders for the studio only, on a submitted recipe only', async () => {
    const { id } = await submitted();
    const reason = 'Face retention check';
    await expect(startReviewRenders({ sql: h.sql, store, faces }, maker, { action: 'render', id, reason })).rejects.toThrow('forbidden');
    const result = await startReviewRenders({ sql: h.sql, store, faces }, ADMIN_VIEWER, { action: 'render', id, reason });
    expect(result.renderIds).toHaveLength(REVIEW_RENDERS);
    for (const renderId of result.renderIds) expect(await loadJobRecipe(h.sql, renderId)).toMatchObject({ purpose: 'studio_review', formatId: id });
    // The maker's three test renders are untouched.
    const entry = (await loadReviewEntries(h.sql, [id])).get(id)!;
    expect(entry).toMatchObject({ valid: true, medium: 'image', testRendersUsed: 0, royaltyKrw: 2000, presentation: 'story-first' });
    expect(entry.renders).toHaveLength(3);
    expect(entry.quote!.proposedKrw).toBe(entry.quote!.floorKrw + 2000);
    await expect(startReviewRenders({ sql: h.sql, store, faces: async () => [] }, ADMIN_VIEWER, { action: 'render', id, reason })).rejects.toThrow('no_faces');
  });

  it('accepts with a price at or above the floor and copies recipe, page choices, price and author', async () => {
    const { id } = await submitted({ prompts: true, assets: true });
    const entry = (await loadReviewEntries(h.sql, [id])).get(id)!;
    await expect(administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id, accept: true, reason: 'Reviewed recipe' })).rejects.toThrow('price_required');
    await expect(administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id, accept: true, priceKrw: entry.quote!.floorKrw - 100, reason: 'Reviewed recipe' })).rejects.toThrow('price_below_floor');
    const accepted = await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id, accept: true, priceKrw: 4900, reason: 'Reviewed recipe' });
    const template = (await loadPromptById(h.sql, accepted.id))!;
    expect(template).toMatchObject({ status: 'pending', authorId: maker.userId, priceKrw: 4900, titleKo: '네온 다이너', engine: 'gpt-image-2', aspectDefault: '4:5', medium: 'image', textVisibility: 'hidden' });
    expect(template.priceCents).toBe(Math.ceil(4900 / 1400 * 100));
    expect((await loadTemplateRecipe(h.sql, accepted.id))!.steps[0]!.prompt).toContain(CANARY);
    expect((await h.sql.query<{ disclosure: unknown; presentation: string }>('select disclosure,presentation from prompt_items where id=$1', [accepted.id])).rows[0]).toEqual({ disclosure: { prompts: true, assets: true }, presentation: 'story-first' });
    // 0059's guard: the maker's recipe and their disclosure choice are frozen once linked.
    await expect(h.sql.query("update prompt_items set recipe=null where id=$1", [accepted.id])).rejects.toThrow('platform private format contract');
    await expect(h.sql.query(`update prompt_items set disclosure='{"prompts":false,"assets":false}'::jsonb where id=$1`, [accepted.id])).rejects.toThrow('platform private format contract');
    await expect(h.sql.query("update prompt_items set text_visibility='public' where id=$1", [accepted.id])).rejects.toThrow('platform private format contract');
    await h.sql.query('update prompt_items set price_krw=5900 where id=$1', [accepted.id]);
    // A v1 format keeps the older acceptance: a price there is refused, not silently dropped.
    const v1 = randomUUID();
    await h.sql.query("insert into platform_formats(id,user_id,title,recipe,example_url,medium) values($1,$2,'Old style','old recipe text that is long enough','https://www.instagram.com/reel/v1v1v1/','image')", [v1, maker.userId]);
    await expect(administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id: v1, accept: true, priceKrw: 4900, reason: 'Old path' })).rejects.toThrow('invalid');
    expect((await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id: v1, accept: true, reason: 'Old path' })).id).toBeTruthy();
  });

  it('never lets a private recipe reach the catalogue, the public projection or its HTML', async () => {
    const { id, file } = await submitted();
    const accepted = await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id, accept: true, priceKrw: 4900, reason: 'Reviewed recipe' });
    await h.sql.query("update prompt_items set status='published',published_at=now() where id=$1", [accepted.id]);
    const catalog = await loadPromptCatalog(h.sql);
    expect(JSON.stringify(catalog)).toContain(accepted.id);
    expect(JSON.stringify(catalog)).not.toContain(CANARY);
    const view = await loadPublicRecipe(h.sql, accepted.id, labels);
    expect(view).toEqual({ presentation: 'story-first', steps: null, files: null });
    expect(JSON.stringify(view)).not.toContain(CANARY);
    expect(renderToStaticMarkup(HowItWasMade({ recipe: view!, copy: en.makerRecipe }) ?? <></>)).toBe('');
    // Undisclosed files stay private even once the template is published.
    expect(await makerFileObject(h.sql, viewerOf('anon'), file.id)).toBeNull();
    // The maker's own pages and the platform home carry no recipe either.
    expect(JSON.stringify(await platformHome(h.sql, maker))).not.toContain(CANARY);
    expect(JSON.stringify(await loadCreatorWorkspace(h.sql, maker, { onboarding: true }))).not.toContain(CANARY);
  });

  it('shows only what the maker chose to disclose, with [My photo] in place of the token', async () => {
    const { id, file } = await submitted({ prompts: true, assets: true });
    const accepted = await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id, accept: true, priceKrw: 4900, reason: 'Reviewed recipe' });
    expect(await loadPublicRecipe(h.sql, accepted.id, labels)).toBeNull();
    await h.sql.query("update prompt_items set status='published',published_at=now() where id=$1", [accepted.id]);
    const view = (await loadPublicRecipe(h.sql, accepted.id, labels))!;
    expect(view.steps).toEqual([{ n: 1, kind: 'image', prompt: `${CANARY}: [My photo] in a neon diner holding [Reference 1].` }]);
    expect(view.files).toEqual([{ href: `/api/makers/files/${file.id}`, kind: 'image' }]);
    const html = renderToStaticMarkup(HowItWasMade({ recipe: view, copy: en.makerRecipe })!);
    expect(html).toContain('data-recipe-how');
    expect(html).toContain('[My photo]');
    expect(html).not.toContain('{{');
    expect(html).not.toMatch(/ast_[0-9a-f]{32}\.(jpg|png)/);
    expect(await makerFileObject(h.sql, viewerOf('anon'), file.id)).toMatchObject({ publicCache: true });
  });

  it('shows a studio original’s prompts only when the studio disclosed them, and never its files', async () => {
    const id = randomUUID();
    const recipe = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true }, prop: { kind: 'image', source: 'creator', asset: 'ast_0123456789abcdef0123456789abcdef' } },
      steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie', 'prop'], prompt: `${CANARY}: {{selfie}} through a lens holding {{prop}}.`, params: { aspect: '4:5' } }],
      output: { from: 'step1' },
    };
    await h.sql.query(`insert into prompt_items(id,slug,source,status,published_at,models,title,title_ko,prompt_text,text_visibility,use_case,featured,medium,price_cents,price_krw,audience,recipe,disclosure,presentation)
      values($1,$2,'yagi','published',now(),'{gpt-image-2}','Lens portal','렌즈 포털','Studio original.','hidden','{}',false,'image',0,0,'public',$3::jsonb,'{"prompts":false,"assets":true}'::jsonb,'make-first')`, [id, `lens-${id.slice(0, 8)}`, JSON.stringify(recipe)]);
    expect(await loadPublicRecipe(h.sql, id, labels)).toBeNull();
    await h.sql.query(`update prompt_items set disclosure='{"prompts":true,"assets":true}'::jsonb where id=$1`, [id]);
    const view = (await loadPublicRecipe(h.sql, id, labels))!;
    expect(view).toEqual({ presentation: 'make-first', steps: [{ n: 1, kind: 'image', prompt: `${CANARY}: [My photo] through a lens holding [Reference 1].` }], files: null });
    expect(renderToStaticMarkup(HowItWasMade({ recipe: view, copy: en.makerRecipe })!)).not.toMatch(/ast_[0-9a-f]{32}/);
    // An unpublished original stays closed.
    await h.sql.query("update prompt_items set status='archived' where id=$1", [id]);
    expect(await loadPublicRecipe(h.sql, id, labels)).toBeNull();
  });
});
