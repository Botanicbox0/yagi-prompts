import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadFormatRevisionView, recipeSha256, reviseFormatRecipe } from '@/lib/creator-platform/format-revision';
import { MAX_RECIPE_BYTES, MAX_STUDIO_RECIPE_BYTES, legacyPromptText, parseRecipe, type Recipe } from '@/lib/recipes/schema';
import { templateCardStyling } from '@/lib/template-director/compile-prompts';
import { renderLockBlock } from '@/lib/template-director/locks';
import { renderStylingBlock } from '@/lib/template-director/styling';
import { ADMIN_VIEWER, adminHarness, viewerOf, type AdminHarness } from '../helpers/admin';
import { FIXTURE_FILM_PROMPT, carouselRecipe, filmRecipe, seedFormatTemplate, type FormatFixture } from '../helpers/format-fixture';
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
 * docs/CREATOR-PLATFORM.md "Recipe revisions of the studio's own formats (2026-11-25)" — `format.reviseRecipe`: the
 * words of a company-payout format's recipe, and nothing else, revised in one audited transaction; an external
 * creative's format, a structural change, a stale review, a waiting order or a missing migration writes nothing.
 */

// Invented test-photo residue and its replacement (fixture text, not a production prompt).
const RESIDUE = ' The person wears the same grey hoodie as in the test photo.';
const STYLING = renderStylingBlock([
  { part: 'hair', from: 'template', note: 'a sleek low bun.' },
  { part: 'makeup', from: 'template', note: 'soft rosy cheeks.' },
]);
const ko = getDictionary('ko').admin.formatRevision;

describe('format.reviseRecipe', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  async function stored(f: FormatFixture) {
    const { rows } = await sql().query<{ recipe: Recipe; prompt_text: string; rest: Record<string, unknown> }>(
      "select recipe, prompt_text, to_jsonb(p.*) - 'recipe' - 'prompt_text' - 'updated_at' as rest from prompt_items p where id = $1",
      [f.templateId],
    );
    const { rows: formats } = await sql().query<{ recipe: string; recipe_v2: Recipe | null }>('select recipe, recipe_v2 from platform_formats where id = $1', [f.formatId]);
    return { ...rows[0]!, format: formats[0]! };
  }
  const audits = async (f: FormatFixture) =>
    (await sql().query<{ actor_id: string; reason: string; details: Record<string, unknown> }>(
      "select actor_id, reason, details from platform_audit where entity_id = $1 and action = 'format.reviseRecipe' order by created_at",
      [f.templateId],
    )).rows;
  const revisions = async (f: FormatFixture) =>
    (await sql().query<{ before: Recipe; after: Recipe; before_sha256: string; after_sha256: string; reason: string; actor_id: string; prompt_text_before: string; prompt_text_after: string }>(
      'select before, after, before_sha256, after_sha256, reason, actor_id, prompt_text_before, prompt_text_after from platform_format_revisions where template_id = $1 order by created_at',
      [f.templateId],
    )).rows;

  /** A company format whose film prompt carries the test photo's residue. */
  const residueFormat = (options: Parameters<typeof seedFormatTemplate>[1] = {}) =>
    seedFormatTemplate(sql(), { recipe: filmRecipe(`${FIXTURE_FILM_PROMPT}${RESIDUE}`), ...options });

  const cleaned = () => filmRecipe(`${FIXTURE_FILM_PROMPT}\n\n${STYLING}`);

  it('revises a company format’s words: both tables, the legacy copies, the audit (hashes, not bodies), the revision record', async () => {
    const f = await residueFormat();
    const before = await stored(f);
    const next = cleaned();
    const promptsBefore = harness.promptsRevalidated;
    const outcome = await harness.run('format.reviseRecipe', {
      id: f.templateId,
      reviewedSha256: recipeSha256(before.recipe),
      reason: 'Remove the test photo wording; declare the styling',
      recipe: JSON.stringify(next),
    });
    expect(outcome).toMatchObject({ ok: true, code: 'saved', detail: f.slug });
    expect(harness.promptsRevalidated).toBe(promptsBefore + 1);

    const after = await stored(f);
    expect(after.recipe).toEqual(next);
    const parsedNext = parseRecipe(next, { studio: true });
    if (!parsedNext.ok) throw new Error('fixture must parse');
    expect(after.prompt_text).toBe(legacyPromptText(parsedNext.recipe));
    expect(after.prompt_text).not.toContain('test photo');
    // Nothing else on the row moved: price, slug, disclosure, visibility, media, keyframes, published_at, author…
    expect(after.rest).toEqual(before.rest);
    // The format's own copies: recipe_v2, and the legacy text column that held the film prompt.
    expect(after.format.recipe_v2).toEqual(next);
    expect(after.format.recipe).toBe(next.steps[0]!.prompt);
    // The card now shows what the compile honours.
    expect(templateCardStyling({ promptText: after.prompt_text, recipe: after.recipe, recipeReady: true, cast: 'solo' })).toEqual({ styled: ['hair', 'makeup'], photo: [] });

    const [audit] = await audits(f);
    expect(audit).toMatchObject({ actor_id: ADMIN_VIEWER.userId, reason: 'Remove the test photo wording; declare the styling' });
    expect(audit!.details).toMatchObject({
      slug: f.slug,
      formatId: f.formatId,
      beforeSha256: recipeSha256(before.recipe),
      afterSha256: recipeSha256(next),
      changed: ['steps.0.prompt'],
      formatRecipeText: 'updated',
      formatRecipeV2: 'updated',
      promptTextWasLegacy: true,
    });
    // Hashes and lengths only: no prompt words in the audit.
    const auditText = JSON.stringify(audit);
    for (const words of ['grey hoodie', 'rain-lit alley', 'sleek low bun', '{{selfie}}']) expect(auditText).not.toContain(words);

    const [revision] = await revisions(f);
    expect(revision).toMatchObject({ before: before.recipe, after: next, before_sha256: recipeSha256(before.recipe), after_sha256: recipeSha256(next), actor_id: ADMIN_VIEWER.userId });
    expect(revision!.prompt_text_before).toBe(before.prompt_text);
    expect(revision!.prompt_text_after).toBe(after.prompt_text);
  });

  it('the panel’s path: new words per result step (CRLF from the browser), laid on the reviewed recipe; a second revision restores the first', async () => {
    const f = await residueFormat();
    const original = (await stored(f)).recipe;
    const words = `${FIXTURE_FILM_PROMPT}\r\n\r\n${STYLING.replace(/\n/g, '\r\n')}\r\n`;
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(original), reason: 'Panel revision with styling', 'prompt:film': words })).toMatchObject({ ok: true });
    const first = (await stored(f)).recipe;
    expect(first.steps[0]!.prompt).toBe(`${FIXTURE_FILM_PROMPT}\n\n${STYLING}`);

    // Restore: the original words, under the hash of what is stored now.
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(first), reason: 'Roll back to the first text', recipe: JSON.stringify(original) })).toMatchObject({ ok: true });
    expect((await stored(f)).recipe).toEqual(original);
    expect((await revisions(f)).map((r) => [recipeSha256(r.before), recipeSha256(r.after)])).toEqual([
      [recipeSha256(original), recipeSha256(first)],
      [recipeSha256(first), recipeSha256(original)],
    ]);
    // An unknown step, and the same words again, are refused.
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(original), reason: 'Unknown step attempt', 'prompt:movie': 'Words about {{selfie}} here.' })).toMatchObject({ ok: false, detail: 'formatRevision:unknown_step movie' });
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(original), reason: 'Nothing new at all', recipe: JSON.stringify(original) })).toMatchObject({ ok: false, detail: 'formatRevision:unchanged' });
  });

  it('refuses every structural change (engine, input, added step, duration) and writes nothing', async () => {
    const f = await residueFormat();
    const before = await stored(f);
    const reviewed = recipeSha256(before.recipe);
    const bend = (mutate: (r: Record<string, any>) => void) => {
      const next = structuredClone(cleaned()) as Record<string, any>;
      mutate(next);
      return JSON.stringify(next);
    };
    const cases: Array<[string, string]> = [
      [bend((r) => { r.steps[0].engine = 'seedance-2.0'; }), 'steps.0.engine'],
      [bend((r) => { r.steps[0].inputs = ['selfie', 'look']; r.slots.look = { kind: 'image', source: 'user', required: true, role: 'look' }; }), 'slots.look'],
      [bend((r) => { r.steps.unshift({ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'A still of {{selfie}} first.', params: { aspect: '9:16' } }); }), 'steps'],
      [bend((r) => { r.steps[0].params.duration = 12; }), 'steps.0.params.duration'],
    ];
    for (const [recipe, field] of cases) {
      expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason: 'Structural change attempt', recipe })).toMatchObject({ ok: false, code: 'invalid', detail: `formatRevision:structural ${field}` });
    }
    expect(await stored(f)).toEqual(before);
    expect(await audits(f)).toHaveLength(0);
    expect(await revisions(f)).toHaveLength(0);
  });

  it('refuses a stale review, an external creative’s format, a studio original, a short reason and a non-admin', async () => {
    const f = await residueFormat();
    const before = await stored(f);
    const reason = 'Remove the test photo wording';
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(cleaned()), reason, recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: false, detail: 'formatRevision:stale' });

    const external = await residueFormat({ payout: 'external' });
    const refused = await harness.run('format.reviseRecipe', { id: external.templateId, reviewedSha256: recipeSha256(external.recipe), reason, recipe: JSON.stringify(cleaned()) });
    expect(refused).toMatchObject({ ok: false, code: 'invalid', detail: 'formatRevision:not_company' });
    expect(ko.refusals.not_company).toBe('크리에이티브의 포맷은 스튜디오가 고칠 수 없어요.');
    expect((await sql().query<{ recipe: Recipe }>('select recipe from prompt_items where id = $1', [external.templateId])).rows[0]!.recipe).toEqual(external.recipe);

    const original = randomUUID();
    await sql().query(
      `insert into prompt_items (id, slug, source, status, models, title, prompt_text, text_visibility, use_case, featured, medium)
       values ($1, 'studio-original-revision', 'yagi', 'pending', '{seedance-2.5}', 'Studio original', 'Plain text prompt here.', 'hidden', '{}', false, 'video')`,
      [original],
    );
    expect(await harness.run('format.reviseRecipe', { id: original, reviewedSha256: 'a'.repeat(64), reason, recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: false, detail: 'formatRevision:not_format' });
    expect(await harness.run('format.reviseRecipe', { id: randomUUID(), reviewedSha256: 'a'.repeat(64), reason, recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: false, code: 'notFound' });

    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(before.recipe), reason: 'too short', recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: false, detail: 'formatRevision:reason' });
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(before.recipe), reason, recipe: JSON.stringify(cleaned()) }, viewerOf('pro'))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await stored(f)).toEqual(before);
    expect(await audits(f)).toHaveLength(0);
  });

  it('checks every compiled prompt like a save: lock and styling blocks that read, one styling everywhere, both rule sets', async () => {
    // A malformed styling block, and a lock block typo.
    const f = await residueFormat();
    const reviewed = recipeSha256(f.recipe);
    const withText = (text: string) => JSON.stringify(filmRecipe(text));
    const reason = 'Block checks on the revision';
    const badStyling = await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason, recipe: withText(`${FIXTURE_FILM_PROMPT}\n\nTemplate styling:\n- Styled by the template: the eyebrows — arched.`) });
    expect(badStyling).toMatchObject({ ok: false });
    expect(badStyling.detail).toMatch(/^formatRevision:styling step film: template styling: line \d+ unknown_line/);
    const lockTypo = await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason, recipe: withText(`${FIXTURE_FILM_PROMPT}\n\nTemplate lock:\n- Keep exactly as in the template: the hairstyle.`) });
    expect(lockTypo.detail).toMatch(/^formatRevision:locks step film: template locks:/);
    // Styling a part the lock block names.
    const locked = await harness.run('format.reviseRecipe', {
      id: f.templateId, reviewedSha256: reviewed, reason,
      recipe: withText(`${FIXTURE_FILM_PROMPT}\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}\n\n${STYLING}`),
    });
    expect(locked.detail).toMatch(/^formatRevision:styling .*locked_part/);

    // A carousel with the block on one frame only: buyers would see nothing.
    const set = await seedFormatTemplate(sql(), { recipe: carouselRecipe(['Frame one of {{selfie}} by a window.', 'Frame two of {{selfie}} on a stool.']), priceKrw: 9_900 });
    const partial = carouselRecipe([`Frame one of {{selfie}} by a window.\n\n${STYLING}`, 'Frame two of {{selfie}} on a stool.']);
    expect(await harness.run('format.reviseRecipe', { id: set.templateId, reviewedSha256: recipeSha256(set.recipe), reason, recipe: JSON.stringify(partial) })).toMatchObject({ ok: false, detail: 'formatRevision:styling_partial' });
    const whole = carouselRecipe([`Frame one of {{selfie}} by a window.\n\n${STYLING}`, `Frame two of {{selfie}} on a stool.\n\n${STYLING}`]);
    expect(await harness.run('format.reviseRecipe', { id: set.templateId, reviewedSha256: recipeSha256(set.recipe), reason, recipe: JSON.stringify(whole) })).toMatchObject({ ok: true });

    // 2026-11-25 (Seedance 2.5: 15,000 characters per clip): makers and the studio share one byte cap, sized for every
    // step at its limit, so a recipe the studio takes is never dropped by the maker's reader for its size.
    const huge = carouselRecipe(Array.from({ length: 6 }, (_, i) => `Frame ${i + 1} of {{selfie}} in soft light. ${'Calm detail. '.repeat(540)}`.slice(0, 7000).trim()), { studioOnly: true });
    expect(parseRecipe(huge, { studio: true }).ok).toBe(true);
    expect(parseRecipe(huge).ok).toBe(true);
    expect(MAX_RECIPE_BYTES).toBe(MAX_STUDIO_RECIPE_BYTES);
    expect(await audits(f)).toHaveLength(0);
  });

  it('a styled line whose description follows the photo is refused with the same detail prompt.declareStyling gives (#361 rule)', async () => {
    const f = await residueFormat();
    const clause = ['Template styling:', '- Styled by the template: the hairstyle — a sleek low bun, colour as in the photo.'].join('\n');
    const revised = await harness.run('format.reviseRecipe', {
      id: f.templateId, reviewedSha256: recipeSha256(f.recipe), reason: 'Photo clause in a styled line',
      recipe: JSON.stringify(filmRecipe(`${FIXTURE_FILM_PROMPT}\n\n${clause}`)),
    });
    expect(revised).toMatchObject({ ok: false, code: 'invalid' });
    expect(revised.detail).toMatch(/^formatRevision:styling step film: template styling: line \d+ photo_clause — "/);
    expect((await stored(f)).recipe).toEqual(f.recipe);

    // The studio's own tool for a studio original refuses the same block with the same problem and the same quoted line.
    const original = randomUUID();
    await sql().query(
      `insert into prompt_items (id, slug, source, status, models, title, prompt_text, text_visibility, use_case, featured, medium)
       values ($1, 'studio-original-clause', 'yagi', 'pending', '{seedance-2.5}', 'Studio original', $2, 'hidden', '{}', false, 'video')`,
      [original, FIXTURE_FILM_PROMPT.replace('{{selfie}}', '@image1')],
    );
    const declared = await harness.run('prompt.declareStyling', { id: original, block: clause });
    expect(declared.detail).toMatch(/^declareStyling: block: template styling: line 2 photo_clause — "/);
    const quoted = (detail: string | undefined) => detail!.slice(detail!.indexOf(' photo_clause — '));
    expect(quoted(revised.detail)).toBe(quoted(declared.detail));

    // The panel says it in the admin's language, with the template page's sentences for that problem.
    state.sql = sql();
    const html = await page(f.templateId, { err: 'invalid', detail: revised.detail! });
    expect(html).toContain('data-format-revision-refusal="styling"');
    const a = getDictionary('ko').admin;
    expect(html).toContain(a.stylingRefused);
    expect(html).toContain(a.stylingProblemPhotoClause.split('{line}')[1]!.slice(0, 20));
  });

  it('asserts the price floors and never revises under an order that has not taken its recipe snapshot', async () => {
    const f = await residueFormat();
    const reviewed = recipeSha256(f.recipe);
    const reason = 'Floor and order checks';
    await sql().query('update prompt_items set price_krw = 100 where id = $1', [f.templateId]);
    expect((await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason, recipe: JSON.stringify(cleaned()) })).detail).toMatch(/^formatRevision:price_floor 100 < \d+$/);
    await sql().query('update prompt_items set price_krw = 24900, price_1080_krw = 200 where id = $1', [f.templateId]);
    expect((await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason, recipe: JSON.stringify(cleaned()) })).detail).toMatch(/^formatRevision:price_floor_1080 200 < \d+$/);
    await sql().query('update prompt_items set price_1080_krw = 0 where id = $1', [f.templateId]);

    const buyer = randomUUID();
    await sql().query('insert into auth.users (id) values ($1)', [buyer]);
    await sql().query('insert into profiles (id, email) values ($1, $2)', [buyer, 'buyer@example.test']);
    const { rows } = await sql().query<{ id: string }>(
      "insert into render_jobs (user_id, template_id, template_slug, medium, engine, aspect, status) values ($1, $2, $3, 'video', 'seedance-2.5', '9:16', 'queued') returning id",
      [buyer, f.templateId, f.slug],
    );
    const job = rows[0]!.id;
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason, recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: false, detail: 'formatRevision:pending_jobs 1' });
    expect(ko.refusals.pending_jobs).toContain('몇 분 뒤에 다시 시도해 주세요');
    expect((await stored(f)).recipe).toEqual(f.recipe);
    // The pass picked it up and snapshotted the recipe it runs: the order keeps the old words, the revision goes ahead.
    await sql().query("insert into render_job_recipes (render_id, purpose, format_id, recipe) values ($1, 'customer', null, $2::jsonb)", [job, JSON.stringify(f.recipe)]);
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: reviewed, reason, recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: true });
    expect((await sql().query<{ recipe: Recipe }>('select recipe from render_job_recipes where render_id = $1', [job])).rows[0]!.recipe).toEqual(f.recipe);
  });

  it('a format whose legacy text column is empty (the maker editor’s) keeps it; recipe_v2 still follows', async () => {
    const f = await residueFormat({ formatRecipeText: 'empty' });
    expect(await reviseFormatRecipe(sql(), ADMIN_VIEWER.userId, { id: f.templateId, reviewedSha256: recipeSha256(f.recipe), reason: 'Editor-made company format', recipe: cleaned() })).toMatchObject({ ok: true, changed: ['steps.0.prompt'] });
    const after = await stored(f);
    expect(after.format.recipe).toBe('');
    expect(after.format.recipe_v2).toEqual(cleaned());
    expect((await audits(f))[0]!.details).toMatchObject({ formatRecipeText: 'kept', formatRecipeV2: 'updated' });
  });

  it('without migration 0192 it refuses cleanly, and the panel says so instead of offering the form', async () => {
    const f = await residueFormat();
    await harness.db.exec('drop table platform_format_revisions');
    const refused = await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(f.recipe), reason: 'Schema missing check', recipe: JSON.stringify(cleaned()) });
    expect(refused).toMatchObject({ ok: false, code: 'invalid', detail: 'formatRevision:schema_missing 0192' });
    expect(ko.refusals.schema_missing).toBe('이 기능은 마이그레이션 0192 적용 뒤에 쓸 수 있어요.');
    expect((await stored(f)).recipe).toEqual(f.recipe);
    expect(await loadFormatRevisionView(sql(), f.templateId)).toMatchObject({ schemaReady: false, revisions: [] });

    state.sql = sql();
    const html = await page(f.templateId);
    expect(html).toContain('data-format-revision-panel');
    expect(html).toContain('data-format-revision-schema-missing');
    expect(html).toContain('이 기능은 마이그레이션 0192 적용 뒤에 쓸 수 있어요.');
    expect(html).not.toContain('data-format-revision-save');
  });

  it('the admin page: the panel on a company format only — the steps, the reviewed hash, the history', async () => {
    state.sql = sql();
    const f = await residueFormat();
    expect(await harness.run('format.reviseRecipe', { id: f.templateId, reviewedSha256: recipeSha256(f.recipe), reason: 'First revision for the history', recipe: JSON.stringify(cleaned()) })).toMatchObject({ ok: true });
    const html = await page(f.templateId);
    expect(html).toContain('data-format-revision-panel');
    expect(html).toContain('레시피 문구 개정');
    expect(html).toContain('name="prompt:film"');
    expect(html).toContain(`value="${recipeSha256(cleaned())}"`);
    expect(html).toContain('data-format-revision-counter');
    expect(html).toContain('First revision for the history');
    expect(html.match(/data-format-revision-entry/g)).toHaveLength(1);

    // A refusal in the address is said in the admin's language.
    const refusedHtml = await page(f.templateId, { err: 'invalid', detail: 'formatRevision:not_company' });
    expect(refusedHtml).toContain('data-format-revision-refusal="not_company"');

    // An external creative's format and a studio original: no panel at all.
    const external = await residueFormat({ payout: 'external' });
    expect(await page(external.templateId)).not.toContain('data-format-revision-panel');
  });

  it('prompt.declareStyling still refuses a company format, and points at the revision panel', async () => {
    const f = await residueFormat();
    const refused = await harness.run('prompt.declareStyling', { id: f.templateId, block: STYLING });
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toContain('format.reviseRecipe');
    expect(refused.detail).toContain('레시피 문구 개정');
    const external = await residueFormat({ payout: 'external' });
    expect((await harness.run('prompt.declareStyling', { id: external.templateId, block: STYLING })).detail).toContain("creative's format");
  });

  async function page(id: string, query: Record<string, string> = {}): Promise<string> {
    const element = await AdminPromptItemPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });
    const { prelude } = await prerender(element);
    return new Response(prelude).text();
  }
});
