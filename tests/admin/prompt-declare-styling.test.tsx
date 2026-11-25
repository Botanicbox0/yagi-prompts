import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { loadPromptCatalog, toPromptCard } from '@/lib/prompts/catalog';
import { parseRecipe, type Recipe } from '@/lib/recipes/schema';
import { renderLockBlock } from '@/lib/template-director/locks';
import { checkStylingBlock, renderStylingBlock } from '@/lib/template-director/styling';
import { ADMIN_VIEWER, adminHarness, upload, viewerOf, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

const state = vi.hoisted(() => ({ sql: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (path: string, admin: boolean) => (admin ? `https://twings.app${path}` : path),
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
  getViewer: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => state.sql }));

import AdminPromptItemPage from '@/app/(admin)/admin/prompts/[id]/page';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — `prompt.declareStyling`: one `Template styling:` block written into a
 * template's main prompt AND every prompt the compile reads for it (a recipe's result steps), replaced, appended or
 * removed everywhere at once; validated against every text it touches; audited; all or nothing.
 */

const BASE = 'A woman walks through a white studio while the camera pushes in slowly on her face.';
const STYLING = renderStylingBlock([
  { part: 'hair', from: 'template', note: 'a sleek low bun.' },
  { part: 'makeup', from: 'template', note: 'soft rosy cheeks.' },
]);
const HAIR_ONLY = renderStylingBlock([{ part: 'hair', from: 'template', note: 'a sleek low bun.' }]);
/**
 * A block a new person template can be created with (rule 3: it must declare its styling); the fixture then sets the
 * text the case needs. The wardrobe only, so it never meets a hair or makeup lock in a case's text.
 */
const CREATE_BLOCK = renderStylingBlock([{ part: 'outfit', from: 'photo' }]);

const carousel = (prompts: [string, string]): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [
    { id: 'frame1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: prompts[0], params: { aspect: '4:5' } },
    { id: 'frame2', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: prompts[1], params: { aspect: '4:5' } },
  ],
  output: { frames: ['frame1', 'frame2'] },
}) as Recipe;

describe('prompt.declareStyling', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  /**
   * A stored template with exactly `promptText`. A new person template must declare its styling (rule 3), so the row
   * is created with the default block and then given the text the case needs, as a template saved before the rule.
   */
  async function template(promptText: string, slug = 'styling-test', medium: 'video' | 'image' = 'video', cast?: 'pet'): Promise<string> {
    const outcome = await harness.run('prompt.create', {
      title: slug,
      titleKo: '스타일 테스트',
      promptText: /template styling:/i.test(promptText) ? promptText : `${promptText}\n\n${CREATE_BLOCK}`,
      useCase: 'brand-ad',
      textVisibility: 'public',
      models: ['seedance-2.5'],
      medium,
      ...(cast ? { cast } : {}),
      ...(medium === 'video' ? { runtimeSeconds: 10 } : {}),
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true });
    const id = (await loadPromptBySlug(sql(), slug))!.id;
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [id, promptText]);
    return id;
  }

  async function stored(id: string): Promise<{ promptText: string; recipe: Recipe | null }> {
    const { rows } = await sql().query<{ prompt_text: string; recipe: Recipe | null }>("select prompt_text, to_jsonb(p.*)->'recipe' as recipe from prompt_items p where id = $1", [id]);
    return { promptText: rows[0]!.prompt_text, recipe: rows[0]!.recipe };
  }

  async function audits(id: string) {
    const { rows } = await sql().query<{ actor_id: string; reason: string; details: Record<string, unknown> }>(
      "select actor_id, reason, details from platform_audit where entity_id = $1 and action = 'prompt.declareStyling' order by created_at",
      [id],
    );
    return rows;
  }

  it('appends the block to a text template, refreshes the pages, audits, and the card shows it', async () => {
    const id = await template(BASE);
    const before = harness.promptsRevalidated;
    expect(await harness.run('prompt.declareStyling', { id, block: STYLING })).toMatchObject({ ok: true, code: 'saved', detail: 'styling-test' });
    expect((await stored(id)).promptText).toBe(`${BASE}\n\n${STYLING}`);
    expect(harness.promptsRevalidated).toBe(before + 1);
    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(ADMIN_VIEWER.userId);
    expect(rows[0]!.reason).toBe('admin_template_styling');
    expect(rows[0]!.details).toMatchObject({ slug: 'styling-test', parts: { styled: ['hair', 'makeup'], photo: [] }, texts: 1, recipeChanged: false, removed: false });

    // Published: the catalogue card carries the projection, names only.
    await sql().query("update prompt_items set status = 'published', published_at = now() where id = $1", [id]);
    const catalog = await loadPromptCatalog(sql(), { publicUrl: () => null });
    const card = catalog.video.find((c) => c.id === id)!;
    expect(card.styling).toEqual({ styled: ['hair', 'makeup'], photo: [] });
    expect(JSON.stringify(card)).not.toContain('sleek low bun');

    // The marks editor now takes the styled parts too (the one-line change in `prompt.marks`).
    const hair = { index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: '낮게 묶은 머리' };
    expect(await harness.run('prompt.marks', { id, marks: JSON.stringify([hair]) })).toMatchObject({ ok: true });
  });

  it('replaces an older block in place, and an empty block removes it', async () => {
    const id = await template(`${BASE}\n\n${HAIR_ONLY}\n\nEnd.`);
    expect(await harness.run('prompt.declareStyling', { id, block: STYLING })).toMatchObject({ ok: true });
    expect((await stored(id)).promptText).toBe(`${BASE}\n\n${STYLING}\n\nEnd.`);
    expect(await harness.run('prompt.declareStyling', { id, block: '' })).toMatchObject({ ok: true });
    expect((await stored(id)).promptText).toBe(`${BASE}\n\nEnd.`);
    const rows = await audits(id);
    expect(rows.map((r) => r.details.removed)).toEqual([false, true]);
  });

  it('a recipe template: the main text and every result step, in one write', async () => {
    const id = await template('Frame one of @image1.', 'styling-set', 'image');
    const recipe = carousel(['Frame one of {{selfie}} by a window.', 'Frame two of {{selfie}} on a stool.']);
    await sql().query('update prompt_items set recipe = $2::jsonb where id = $1', [id, JSON.stringify(recipe)]);

    expect(await harness.run('prompt.declareStyling', { id, block: STYLING })).toMatchObject({ ok: true });
    const after = await stored(id);
    expect(after.promptText).toBe(`Frame one of @image1.\n\n${STYLING}`);
    expect(after.recipe!.steps.map((s) => s.prompt)).toEqual([
      `Frame one of {{selfie}} by a window.\n\n${STYLING}`,
      `Frame two of {{selfie}} on a stool.\n\n${STYLING}`,
    ]);
    expect(parseRecipe(after.recipe, { studio: true }).ok).toBe(true);
    expect((await audits(id))[0]!.details).toMatchObject({ texts: 3, recipeChanged: true });
  });

  it('validates every text it touches and writes nothing when one fails', async () => {
    // A step whose own lock block names the hair: the main text alone would take the block, the step refuses it.
    const id = await template('Main text.', 'styling-locked-step', 'image');
    const recipe = carousel(['Frame one of {{selfie}}.', `Frame two of {{selfie}}.\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}`]);
    await sql().query('update prompt_items set recipe = $2::jsonb where id = $1', [id, JSON.stringify(recipe)]);
    const before = await stored(id);
    const refused = await harness.run('prompt.declareStyling', { id, block: HAIR_ONLY });
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toMatch(/step frame2: template styling: line \d+ locked_part/);
    expect(await stored(id)).toEqual(before);
    expect(await audits(id)).toHaveLength(0);

    // A main text that locks the hair.
    const locked = await template(`${BASE}\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}`, 'styling-locked-main');
    expect(await harness.run('prompt.declareStyling', { id: locked, block: HAIR_ONLY })).toMatchObject({ ok: false, code: 'invalid' });

    // A block that does not read, or more than a block.
    const plain = await template(BASE, 'styling-bad-block');
    for (const block of ['Template styling:\n- Styled by the template: the eyebrows — arched.', `${STYLING}\n\nMore prose.`, 'Just prose.']) {
      expect(await harness.run('prompt.declareStyling', { id: plain, block })).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect((await stored(plain)).promptText).toBe(BASE);
    expect(checkStylingBlock((await stored(plain)).promptText).state).toBe('none');
  });

  it('a pet template: the cast is read from `cast_kind` like the card, so declaring is refused and nothing is written', async () => {
    const id = await template(BASE, 'styling-pet', 'video', 'pet');
    expect((await loadPromptBySlug(sql(), 'styling-pet'))!.cast).toBe('pet');
    const before = await stored(id);
    const refused = await harness.run('prompt.declareStyling', { id, block: STYLING });
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toContain('pet template');
    expect(await stored(id)).toEqual(before);
    expect(await audits(id)).toHaveLength(0);

    // The card agrees: a pet template claims nothing, even with a block written by hand.
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [id, `${BASE}\n\n${STYLING}`]);
    const card = toPromptCard((await loadPromptBySlug(sql(), 'styling-pet'))!, { publicUrl: () => null });
    expect(card.cast).toBe('pet');
    expect(card.styling).toBeUndefined();
    // Removing it is allowed (nothing is offered either way).
    expect(await harness.run('prompt.declareStyling', { id, block: '' })).toMatchObject({ ok: true });
    expect((await stored(id)).promptText).toBe(BASE);
  });

  it("refuses to rewrite a creative's recipe (their format keeps it), and is for admins only", async () => {
    const id = await template('Main text.', 'styling-creative', 'image');
    await sql().query('update prompt_items set recipe = $2::jsonb where id = $1', [id, JSON.stringify(carousel(['Frame one of {{selfie}}.', 'Frame two of {{selfie}}.']))]);
    const creative = randomUUID();
    await sql().query('insert into auth.users (id) values ($1)', [creative]);
    await sql().query('insert into profiles (id, email) values ($1, $2)', [creative, 'creative@example.test']);
    await sql().query("insert into platform_formats(id,user_id,title,recipe,medium,status,template_id) values($1,$2,'Owned','','image','accepted',$3)", [randomUUID(), creative, id]);
    const before = await stored(id);
    const refused = await harness.run('prompt.declareStyling', { id, block: STYLING });
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toContain("creative's format");
    expect(await stored(id)).toEqual(before);

    const other = await template(BASE, 'styling-admins');
    expect(await harness.run('prompt.declareStyling', { id: other, block: STYLING }, viewerOf('pro'))).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await stored(other)).promptText).toBe(BASE);
  });

  it('the admin page: the status line, the source of a recipe template, the free preview and the form', async () => {
    state.sql = sql();
    const id = await template(`${BASE}\n\n${STYLING}`, 'styling-page');
    const html = await page(id);
    expect(html).toContain('data-template-styling="ok"');
    expect(html).toContain('스타일: 헤어 템플릿 · 메이크업 템플릿');
    expect(html).toContain('data-template-styling-shown');
    // Three cases, each the deterministic (no-model) compile with the own rule and the template's style excluded.
    for (const parts of ['hair', 'makeup', 'hair+makeup']) expect(html).toContain(`data-template-styling-case="${parts}"`);
    expect(html).toContain('Taken from the photo: the hairstyle.');
    expect(html).toContain('data-template-styling-declare');

    const plain = await template(BASE, 'styling-plain-page');
    const plainHtml = await page(plain);
    expect(plainHtml).toContain('data-template-styling-none');
    expect(plainHtml).not.toContain('data-template-styling-case');

    // A recipe template whose main text alone declares it: buyers see nothing, and the page says why.
    const set = await template(`Frame one of @image1.\n\n${STYLING}`, 'styling-page-set', 'image');
    await sql().query('update prompt_items set recipe = $2::jsonb where id = $1', [set, JSON.stringify(carousel(['Frame one of {{selfie}}.', 'Frame two of {{selfie}}.']))]);
    const setHtml = await page(set);
    expect(setHtml).toContain('data-template-styling-mismatch');
    expect(setHtml).toContain('data-template-styling-recipe');

    const malformed = await template(BASE, 'styling-malformed');
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [malformed, `${BASE}\n\nTemplate styling:\n- Styled by the template: the eyebrows — arched.`]);
    expect(await page(malformed)).toContain('data-template-styling="malformed"');
  });

  async function page(id: string): Promise<string> {
    const element = await AdminPromptItemPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    const { prelude } = await prerender(element);
    return new Response(prelude).text();
  }
});
