import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { TEMPLATE_KEEP_LINE_PREFIX } from '@/lib/template-director/locks';
import { adminHarness, upload, viewerOf, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';
import { renderStylingBlock } from '@/lib/template-director/styling';

/** The wardrobe only, so it never meets a hair or makeup lock in a case's text (rule 3 needs some block to create). */
const CREATE_BLOCK = renderStylingBlock([{ part: 'outfit', from: 'photo' }]);

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
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — `prompt.marks`, the first admin writer of `prompt_items.keyframes`: it
 * replaces a template's marks (a description and a time range per fixed part), keeps the beats the row already has,
 * and refuses a mark for a part the stored prompt does not declare.
 */

const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const BASE = 'A woman walks through a neon alley at night while the camera dollies back slowly.';
const LOCKED = [BASE, '', 'Template locks:', `${KEEP}the product.`, `${KEEP}the hairstyle — a bright pink chin-length bob.`].join('\n');
const BEATS = [
  { index: 0, timeSeconds: 1, labelKo: '오프닝', labelEn: 'Opening' },
  { index: 1, timeSeconds: 7, labelKo: '피날레', labelEn: 'Finale' },
];
const HAIR = { index: 0, timeSeconds: 3, endSeconds: 6, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' };
const PRODUCT = { index: 1, timeSeconds: 0.5, endSeconds: 2, part: 'product', labelKo: '세럼 병' };

describe('prompt.marks', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  /**
   * A stored template with exactly `promptText`. A new person template must declare its styling (docs/PERSONAL-STUDIO.md
   * §3.4.9, rule 3), so a text without a block is created with one and then given the text the case needs, as a
   * template saved before the rule.
   */
  async function template(promptText: string, slug = 'marks-test', medium: 'video' | 'image' = 'video'): Promise<string> {
    const declared = /template styling:/i.test(promptText);
    const outcome = await harness.run('prompt.create', {
      title: slug,
      titleKo: '마크 테스트',
      promptText: declared ? promptText : `${promptText}\n\n${CREATE_BLOCK}`,
      useCase: 'brand-ad',
      textVisibility: 'public',
      models: ['seedance-2.5'],
      medium,
      ...(medium === 'video' ? { runtimeSeconds: 10 } : {}),
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true });
    const id = (await loadPromptBySlug(sql(), slug))!.id;
    if (!declared) await sql().query('update prompt_items set prompt_text = $2 where id = $1', [id, promptText]);
    return id;
  }

  async function keyframes(id: string): Promise<unknown> {
    const { rows } = await sql().query<{ keyframes: unknown }>('select keyframes from prompt_items where id = $1', [id]);
    return rows[0]?.keyframes ?? null;
  }

  async function audits(id: string) {
    const { rows } = await sql().query<{ action: string; actor_id: string; details: Record<string, unknown> }>(
      "select action, actor_id, details from platform_audit where entity_id = $1 and action = 'prompt.marks' order by created_at",
      [id],
    );
    return rows;
  }

  it('writes the marks, keeps the beats, refreshes the template pages and leaves an audit row', async () => {
    const id = await template(LOCKED);
    await sql().query('update prompt_items set keyframes = $2::jsonb where id = $1', [id, JSON.stringify(BEATS)]);
    const before = harness.promptsRevalidated;

    expect(await harness.run('prompt.marks', { id, marks: JSON.stringify([HAIR, PRODUCT]) })).toMatchObject({ ok: true, code: 'saved' });
    expect(await keyframes(id)).toEqual([
      { index: 0, timeSeconds: 0.5, endSeconds: 2, part: 'product', labelKo: '세럼 병' },
      { index: 1, timeSeconds: 1, labelKo: '오프닝', labelEn: 'Opening' },
      { index: 2, timeSeconds: 3, endSeconds: 6, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' },
      { index: 3, timeSeconds: 7, labelKo: '피날레', labelEn: 'Finale' },
    ]);
    expect(harness.promptsRevalidated).toBe(before + 1);
    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe('f0000000-0000-4000-8000-000000000003');
    expect(rows[0]!.details).toMatchObject({ marks: 2, beats: 2, parts: ['hair', 'product'] });

    // Marks are replaced, beats stay; an empty list clears the marks.
    expect(await harness.run('prompt.marks', { id, marks: JSON.stringify([{ ...HAIR, timeSeconds: 4 }]) })).toMatchObject({ ok: true });
    expect((await keyframes(id)) as unknown[]).toHaveLength(3);
    expect(await harness.run('prompt.marks', { id, marks: '[]' })).toMatchObject({ ok: true });
    expect(await keyframes(id)).toEqual(BEATS);
    expect(await audits(id)).toHaveLength(3);
  });

  it('clears the column when there are no beats and no marks left', async () => {
    const id = await template(LOCKED);
    expect(await harness.run('prompt.marks', { id, marks: JSON.stringify([HAIR]) })).toMatchObject({ ok: true });
    expect(await keyframes(id)).toEqual([{ index: 0, timeSeconds: 3, endSeconds: 6, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' }]);
    expect(await harness.run('prompt.marks', { id, marks: '[]' })).toMatchObject({ ok: true });
    expect(await keyframes(id)).toBeNull();
  });

  it('refuses a part the stored prompt does not declare, and writes nothing', async () => {
    const id = await template(LOCKED);
    const outcome = await harness.run('prompt.marks', { id, marks: JSON.stringify([HAIR, { ...PRODUCT, part: 'logo' }]) });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(outcome.detail).toContain('logo');
    expect(await keyframes(id)).toBeNull();
    expect(await audits(id)).toHaveLength(0);

    const plain = await template(BASE, 'plain-marks');
    expect(await harness.run('prompt.marks', { id: plain, marks: JSON.stringify([HAIR]) })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses more than twelve entries with the beats, more than two marks per part, and a range that ends before it starts', async () => {
    const id = await template(LOCKED);
    const ten = Array.from({ length: 10 }, (_, i) => ({ index: i, timeSeconds: i * 0.5 }));
    await sql().query('update prompt_items set keyframes = $2::jsonb where id = $1', [id, JSON.stringify(ten)]);
    const three = [HAIR, { ...HAIR, timeSeconds: 7, endSeconds: 8 }, PRODUCT];
    expect(await harness.run('prompt.marks', { id, marks: JSON.stringify(three) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await keyframes(id)).toEqual(ten);

    const fresh = await template(LOCKED, 'per-part');
    const hairs = [HAIR, { ...HAIR, timeSeconds: 7, endSeconds: 8 }, { ...HAIR, timeSeconds: 8.5, endSeconds: 9 }];
    expect(await harness.run('prompt.marks', { id: fresh, marks: JSON.stringify(hairs) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await harness.run('prompt.marks', { id: fresh, marks: JSON.stringify([{ ...HAIR, endSeconds: 3 }]) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await harness.run('prompt.marks', { id: fresh, marks: JSON.stringify([{ ...HAIR, endSeconds: 11 }]) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await harness.run('prompt.marks', { id: fresh, marks: 'not json' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await harness.run('prompt.marks', { id: fresh, marks: JSON.stringify(Array.from({ length: 13 }, () => HAIR)) })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await keyframes(fresh)).toBeNull();
  });

  it('is for films only, and admins only', async () => {
    const image = await template(LOCKED, 'image-marks', 'image');
    expect(await harness.run('prompt.marks', { id: image, marks: JSON.stringify([HAIR]) })).toMatchObject({ ok: false, code: 'invalid' });
    const id = await template(LOCKED, 'admins-only');
    expect(await harness.run('prompt.marks', { id, marks: JSON.stringify([HAIR]) }, viewerOf('pro'))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await keyframes(id)).toBeNull();
  });

  it('the admin template page offers the marks editor next to the lock line, only for a declared film', async () => {
    state.sql = sql();
    const id = await template(LOCKED);
    await harness.run('prompt.marks', { id, marks: JSON.stringify([HAIR]) });
    const html = await page(id);
    expect(html).toContain('data-template-marks');
    expect(html).toContain('data-maker-keyframe-picker');
    expect(html).toContain('data-keyframe-part');
    expect(html).toContain('핑크 단발');
    expect(html).not.toContain('data-keyframe-recommend');

    const plain = await template(BASE, 'plain-page');
    expect(await page(plain)).not.toContain('data-template-marks');
  });

  async function page(id: string): Promise<string> {
    const element = await AdminPromptItemPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    const { prelude } = await prerender(element);
    return new Response(prelude).text();
  }
});
