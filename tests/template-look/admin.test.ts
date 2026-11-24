import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PromptFields } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadPromptBySlug, loadPromptLook } from '@/lib/prompts/repo';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';
import { TEMPLATE_STYLING_DEFAULT_BLOCK } from '@/lib/template-director/styling';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — "대상: 누구나 / 여성 스타일 / 남성 스타일" on the admin template form, saved through
 * the existing `prompt.create` / `prompt.update` operations. A change leaves a `platform_audit` row; a value outside
 * the three is refused; a form without the select (0190 not applied, an older tab) leaves the style alone.
 */

describe('the template style on the admin form', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => { harness = await adminHarness(); });
  afterEach(async () => harness.close());

  const authoring = {
    title: 'Look test',
    titleKo: '스타일 테스트',
    // A new person template declares its hair and makeup (docs/PERSONAL-STUDIO.md §3.4.9, rule 3).
    promptText: `A long enough prompt text for the authoring schema to accept it as a real prompt body.\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`,
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  };

  const audits = async (id: string) =>
    (await sql().query<{ action: string; reason: string; details: Record<string, unknown> }>(
      "select action, reason, details from platform_audit where entity_id = $1 and action = 'prompt.look' order by created_at",
      [id],
    )).rows;

  it('shows the select only when handed a value (0190 applied), women’s style before men’s', () => {
    const dict = getDictionary('ko');
    expect(renderToStaticMarkup(createElement(PromptFields, { row: null, dict }))).not.toContain('name="look"');
    const html = renderToStaticMarkup(createElement(PromptFields, { row: null, dict, look: 'any' }));
    expect(html).toContain('name="look"');
    expect(html).toContain('대상');
    expect(html).toMatch(/<option value="any" selected="">누구나<\/option><option value="female">여성 스타일<\/option><option value="male">남성 스타일<\/option>/);
  });

  it('creates a one-style template and audits it; a template for anyone writes no audit', async () => {
    expect(await harness.run('prompt.create', { ...authoring, look: 'female' } as never)).toMatchObject({ ok: true });
    const row = (await loadPromptBySlug(sql(), 'look-test'))!;
    expect(await loadPromptLook(sql(), row.id)).toBe('female');
    expect(await audits(row.id)).toEqual([{ action: 'prompt.look', reason: 'admin_template_look', details: { slug: 'look-test', from: 'any', to: 'female' } }]);

    expect(await harness.run('prompt.create', { ...authoring, title: 'Look plain', look: 'any' } as never)).toMatchObject({ ok: true });
    const plain = (await loadPromptBySlug(sql(), 'look-plain'))!;
    expect(await loadPromptLook(sql(), plain.id)).toBe('any');
    expect(await audits(plain.id)).toEqual([]);
  });

  it('changes the style on edit (audited), and an edit without the field keeps it', async () => {
    expect(await harness.run('prompt.create', { ...authoring, look: 'female' } as never)).toMatchObject({ ok: true });
    const row = (await loadPromptBySlug(sql(), 'look-test'))!;
    const base = { id: row.id, slug: row.slug, title: row.title, titleKo: row.titleKo ?? '', promptText: row.promptText, useCase: 'brand-ad', handle: '', textVisibility: row.textVisibility, featured: '', models: row.models };

    expect(await harness.run('prompt.update', base as never)).toMatchObject({ ok: true });
    expect(await loadPromptLook(sql(), row.id)).toBe('female');

    expect(await harness.run('prompt.update', { ...base, look: 'male' } as never)).toMatchObject({ ok: true });
    expect(await loadPromptLook(sql(), row.id)).toBe('male');
    // The same value again writes no second audit row.
    expect(await harness.run('prompt.update', { ...base, look: 'male' } as never)).toMatchObject({ ok: true });
    expect((await audits(row.id)).map((audit) => audit.details)).toEqual([
      { slug: 'look-test', from: 'any', to: 'female' },
      { slug: 'look-test', from: 'female', to: 'male' },
    ]);
  });

  it('refuses a value outside the three, writing nothing', async () => {
    const outcome = await harness.run('prompt.create', { ...authoring, look: 'unisex' } as never);
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(outcome.detail).toMatch(/^look:/);
    expect(await loadPromptBySlug(sql(), 'look-test')).toBeNull();
  });

  it('refuses a one-style label before writing anything when 0190 is missing', async () => {
    await sql().query('alter table prompt_items drop column look');
    const outcome = await harness.run('prompt.create', { ...authoring, look: 'male' } as never);
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(outcome.detail).toMatch(/0190_core_template_look/);
    expect(await loadPromptBySlug(sql(), 'look-test')).toBeNull();
    // A form without the select still saves as before.
    expect(await harness.run('prompt.create', authoring as never)).toMatchObject({ ok: true });
  });
});
